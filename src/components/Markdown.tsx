import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

/** 兜底：把纯文本按段转义成安全 HTML（不做 Markdown 解析） */
function plain(text: string): string {
  const esc = (s: string) =>
    s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, '<br/>')}</p>`)
    .join('')
}

export default function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    if (!text) return ''
    try {
      const raw = marked.parse(text) as string
      return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] })
    } catch {
      // marked 对畸形输入（未闭合的表格/链接、超长单行等）偶有异常。
      // 不能让它冒到渲染阶段 —— 那会触发错误边界，把整块产出变成错误页。
      // 降级成纯文本仍然可读。
      try {
        return DOMPurify.sanitize(plain(text), { ADD_ATTR: ['target'] })
      } catch {
        return ''
      }
    }
  }, [text])

  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}
