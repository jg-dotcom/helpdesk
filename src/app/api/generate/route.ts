import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { action, employee, notes, lastDay, reason, onboardingDetails } = await req.json()

  let prompt = ''

  if (action === 'onboarding') {
    const details = onboardingDetails || {}
    prompt = `You are writing an onboarding welcome pack for a small business. Write this as a professional but warm document the owner can give directly to the new employee.

Employee: ${employee.name}
Role: ${employee.role}
Start date: ${employee.start}
${details.startTime ? `Start time: ${details.startTime}` : ''}
${details.reportTo ? `Reports to: ${details.reportTo}` : ''}
${details.payRate ? `Pay rate: ${details.payRate}` : ''}
${details.dresscode ? `Dress code: ${details.dresscode}` : ''}
${details.firstWeek ? `First week schedule: ${details.firstWeek}` : ''}
${details.policies ? `Key policies: ${details.policies}` : ''}

Write the welcome pack with these sections:
1. A warm welcome paragraph (3-4 sentences, friendly and human — this is a small local business)
2. "Your first day" — 4-5 bullet points about what to expect
3. "Important details" — a clean list of the key info (start time, dress code, who to report to, pay, etc.) — only include items that were provided
4. "Day 1 checklist" — 6-8 practical tasks the employee needs to complete in their first week (tax forms, direct deposit, emergency contact, etc.)
5. "Our policies" — 3-4 short bullet points about key expectations (punctuality, phone use, calling in sick, etc.) — use the provided policies if given, otherwise write sensible defaults for a small business
6. A closing line: "By starting work, you acknowledge you have received and understood this welcome pack."

Keep it under 400 words total. Plain language, no corporate HR jargon. Format it cleanly so it reads like a real document.`

  } else if (action === 'checkin') {
    prompt = `Write a short, honest performance check-in note for a small business owner's records about their employee ${employee.name} (${employee.role}). Based on these notes from the owner: "${notes || 'Generally doing well, no major issues'}". Write 2-3 sentences summarizing performance, note one strength and one area to improve. Keep it factual and fair. Plain language, no HR buzzwords.`

  } else if (action === 'offboarding') {
    prompt = `Create a simple offboarding checklist for a small business. Employee: ${employee.name}, Role: ${employee.role}, Last day: ${lastDay || 'their last day'}, Reason: ${reason || 'personal reasons'}. List 7-8 practical steps the owner needs to take: keys/access, final pay, any paperwork, notifying the team, a farewell message. Keep it plain and actionable — this owner is not an HR professional. End with a one-sentence note about staying on good terms.`
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const data = await response.json()
  const text = data.content?.[0]?.text || 'Error generating response.'

  return NextResponse.json({ text })
}
