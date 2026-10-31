const SECRET = /^(?:authorization|cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|credential)$/iu
function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.replace(/\bBearer\s+\S+/giu, 'Bearer [已隐藏]') : value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET.test(key)).map(([key, item]) => [key, redact(item)]))
}
export function executionFrame(frame) {
  const event = (item) => ({ type: item.type, seq: item.seq, time: item.time, data: redact(item.data) })
  if (frame.type === 'snapshot') return { type: 'snapshot', cursor: frame.cursor, hasMore: frame.hasMore, records: (frame.records || []).map((item) => ({ type: 'event', event: event(item.event) })), assistantStream: frame.assistantStream || null }
  if (frame.type === 'event') return { type: 'event', event: event(frame.event) }
  return redact(frame)
}
