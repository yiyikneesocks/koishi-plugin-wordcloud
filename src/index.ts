// koishi-plugin-wordcloud
// 聊天词云：读取 koishi-plugin-chatlog 收集的历史消息分词，用 puppeteer 渲染 SVG 词云。
// 从原 dedide index.ts 的 wordcloud 部分原样迁移，只把数据读取改为 ctx.chatlog 服务。
import { Schema, Context } from 'koishi'
import { } from 'koishi-plugin-puppeteer'
import { } from 'koishi-plugin-chatlog'

export const name = 'wordcloud'
export const inject = { required: ['database', 'chatlog', 'puppeteer'] }

export interface Config {
  wordcloudDefaultLimit?: number
  wordcloudMaxLimit?: number
  wordcloudWidth?: number
  wordcloudHeight?: number
  wordcloudFont?: string
  wordcloudStopWords?: string[]
}

export const Config: Schema<Config> = Schema.object({
  wordcloudDefaultLimit: Schema.number().description('词云默认词数').default(60).min(10).max(150),
  wordcloudMaxLimit: Schema.number().description('词云最大词数').default(150).min(10).max(300),
  wordcloudWidth: Schema.number().description('词云图片宽度').default(900).min(300).max(2000),
  wordcloudHeight: Schema.number().description('词云图片高度').default(620).min(200).max(2000),
  wordcloudFont: Schema.string()
    .description('词云字体（需系统已安装）')
    .default('"LXGW WenKai Mono", "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif'),
  wordcloudStopWords: Schema.array(Schema.string())
    .description('词云需要过滤的词（如指令名）'),
})

const DEFAULT_STOP_WORDS = ['wd', 'emix', 'echo', 'mock', 'imitate', '模仿', 'wordcloud', '词云', 'catchup', '补录']

export function apply(ctx: Context, config: Config) {
  const stopWords = new Set(
    (config.wordcloudStopWords?.length ? config.wordcloudStopWords : DEFAULT_STOP_WORDS)
      .map((w) => w.toLowerCase()),
  )

  ctx.command('wordcloud [limit:number]', '生成本群聊天词云')
    .alias('词云')
    .option('days', '-d <days:number> 只统计最近 N 天')
    .usage('wordcloud [词数] [-d 天数]\n数据来源：本群历史消息的 jieba 分词')
    .action(async ({ session, options }, limit) => {
      if (!session.guildId) return '只能在群里用哦'
      if (!session.app.puppeteer) return '缺少 puppeteer，无法生成图片'

      const query: any = { guildId: session.guildId }
      const days = Number(options?.days)
      if (Number.isFinite(days) && days > 0) {
        query.message_time = { $gte: new Date(Date.now() - days * 86400000) }
      }

      let rows: any[]
      try {
        rows = await ctx.database.get('chatlog_message', query) as any[]
      } catch {
        return '读取历史消息失败'
      }
      if (!rows.length) return '本群还没有足够的消息'

      const counter = new Map<string, number>()
      for (const r of rows) {
        let tokens: string[] = []
        try {
          tokens = Array.isArray(r.jbmsg) ? r.jbmsg : JSON.parse(r.jbmsg || '[]')
        } catch {
          tokens = []
        }
        for (const raw of tokens) {
          const w = String(raw).trim()
          // 用码点长度，使 ⏰(1) 与 😀(2) 处理一致
          if (!w || [...w].length < 2) continue
          // 纯数字/标点跳过；但 emoji 保留为词云条目
          const isEmoji = /\p{Extended_Pictographic}/u.test(w)
          if (!isEmoji && /^[\d\s\W]+$/.test(w)) continue
          if (stopWords.has(w.toLowerCase())) continue
          counter.set(w, (counter.get(w) || 0) + 1)
        }
      }

      const maxLimit = config.wordcloudMaxLimit ?? 150
      const defaultLimit = config.wordcloudDefaultLimit ?? 60
      const topN = Math.max(10, Math.min(Number(limit) || defaultLimit, maxLimit))
      const freqs = [...counter.entries()]
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN)

      if (!freqs.length) return '本群还没有足够的消息'

      const title = days > 0 ? `最近 ${days} 天词云` : '本群聊天词云'
      try {
        return await renderWordcloud(ctx, freqs, {
          title,
          width: config.wordcloudWidth ?? 900,
          height: config.wordcloudHeight ?? 620,
          font: config.wordcloudFont,
        })
      } catch (e: any) {
        ctx.logger('wordcloud').warn('词云渲染失败:', e?.message || e)
        return '词云生成失败了'
      }
    })
}

// ─────────────────────────────────────────────────────────────
// 词云渲染（SVG + puppeteer）
// ─────────────────────────────────────────────────────────────
const WC_COLORS = [
  '#6aaa64', '#c9b458', '#4a90d9', '#d95f4a', '#8e6ad9',
  '#d94a9c', '#4ad9c3', '#d98f4a', '#5a6b8c', '#9c6b3f',
]

async function renderWordcloud(
  ctx: Context,
  freqs: { word: string; count: number }[],
  opts: { title?: string; width?: number; height?: number; font?: string } = {},
): Promise<any> {
  const { SVG } = require('koishi-plugin-puppeteer')
  const width = opts.width ?? 900
  const height = opts.height ?? 620
  const fontFamily = opts.font || '"Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif'

  const svg = new SVG({ width, height, viewBox: { top: 0, bottom: height, left: 0, right: width } })
  svg.fill('#ffffff')

  if (opts.title) {
    svg.g({
      fill: '#1a1a1b', textAnchor: 'middle',
      style: `font-family: ${fontFamily}; font-weight: 700`,
    } as any).text(opts.title, width / 2, 46, { fontSize: 30 } as any)
  }

  const topY = 70
  const areaH = height - topY - 20
  const maxCount = freqs[0]?.count || 1
  const minCount = freqs[freqs.length - 1]?.count || 1
  const maxFont = Math.min(width, height) / 7
  const minFont = 16

  const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
  const hits = (a: typeof placed[number]) =>
    placed.some((b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1)

  const cx = width / 2
  const cy = topY + areaH / 2

  freqs.forEach((item, idx) => {
    const t = maxCount === minCount ? 1 : (item.count - minCount) / (maxCount - minCount)
    const fontSize = Math.round(minFont + t * (maxFont - minFont))

    // 中文按 1em、英文/数字按 0.62em（统一按 0.72 会低估中文宽度导致重叠）
    let emWidth = 0
    for (const ch of item.word) {
      emWidth += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.62
    }
    const w = emWidth * fontSize
    const h = fontSize * 1.12

    let ok = false
    let x = 0
    let y = 0
    for (let step = 0; step < 3000; step++) {
      const angle = step * 0.35
      const radius = fontSize * 0.28 * Math.sqrt(step)
      x = cx + radius * Math.cos(angle)
      y = cy + radius * Math.sin(angle) * 0.72
      const rect = { x1: x - w / 2, y1: y - h / 2, x2: x + w / 2, y2: y + h / 2 }
      if (rect.x1 < 10 || rect.x2 > width - 10 || rect.y1 < topY || rect.y2 > height - 10) continue
      if (!hits(rect)) {
        placed.push(rect)
        ok = true
        break
      }
    }
    if (!ok) return

    const color = WC_COLORS[idx % WC_COLORS.length]
    const weight = t > 0.55 ? 700 : 500
    svg.g({ fill: color } as any).text(item.word, x, y + fontSize * 0.35, {
      fontSize, textAnchor: 'middle',
      style: `font-family: ${fontFamily}; font-weight: ${weight}`,
    } as any)
  })

  return svg.render(ctx)
}
