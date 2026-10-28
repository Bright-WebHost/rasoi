/** "7:30 PM" for today, "Tue 21 Oct, 7:30 PM" otherwise (India time). */
export function formatPickupTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return null
  const tz = 'Asia/Kolkata'
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz })
  const time = when.toLocaleTimeString('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
  if (day(when) === day(new Date())) return time
  const date = when.toLocaleDateString('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })
  return `${date}, ${time}`
}
