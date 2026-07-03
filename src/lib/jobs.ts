export type JobPosting = {
  id: number
  user_id: string
  title: string
  department: string | null
  location: string | null
  employment_type: string
  description: string | null
  requirements: string | null
  pay_min: number | null
  pay_max: number | null
  pay_period: string
  status: string
  created_at: string
}

export type JobStatus = 'open' | 'closed' | 'draft'

export function formatPayRange(
  min: number | null,
  max: number | null,
  period: string
): string {
  if (!min && !max) return 'Pay not specified'
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
  const periodLabel = period === 'yearly' ? '/yr' : '/hr'
  if (min && max) return `${fmt(min)} – ${fmt(max)}${periodLabel}`
  if (min) return `From ${fmt(min)}${periodLabel}`
  return `Up to ${fmt(max!)}${periodLabel}`
}

export function validateJobPosting(job: Partial<JobPosting>): string[] {
  const errors: string[] = []
  if (!job.title?.trim()) errors.push('Title is required.')
  if (!job.employment_type?.trim()) errors.push('Employment type is required.')
  if (job.pay_min != null && job.pay_max != null && job.pay_min > job.pay_max) {
    errors.push('Minimum pay cannot exceed maximum pay.')
  }
  if (job.pay_min != null && job.pay_min < 0) errors.push('Pay cannot be negative.')
  if (job.pay_max != null && job.pay_max < 0) errors.push('Pay cannot be negative.')
  return errors
}

export function statusLabel(status: string): string {
  if (status === 'open') return 'Open'
  if (status === 'closed') return 'Closed'
  if (status === 'draft') return 'Draft'
  return status
}

export function statusColor(status: string): string {
  if (status === 'open') return '#27ae60'
  if (status === 'closed') return '#c0392b'
  return '#9a9a9a'
}

export function formatLinkedInPost(job: JobPosting, careersUrl: string): string {
  const pay = formatPayRange(job.pay_min, job.pay_max, job.pay_period)
  return [
    `We're hiring: ${job.title}${job.location ? ` in ${job.location}` : ''}`,
    '',
    job.description ?? '',
    '',
    `Type: ${job.employment_type}`,
    pay !== 'Pay not specified' ? `Pay: ${pay}` : '',
    '',
    `Apply here: ${careersUrl}`,
  ].filter(line => line !== null).join('\n').trim()
}

export function formatIndeedPost(job: JobPosting, careersUrl: string): string {
  return [
    job.title,
    job.location ?? 'Remote',
    job.employment_type,
    formatPayRange(job.pay_min, job.pay_max, job.pay_period),
    '',
    job.description ?? '',
    job.requirements ? `\nRequirements:\n${job.requirements}` : '',
    '',
    `Learn more: ${careersUrl}`,
  ].join('\n').trim()
}
