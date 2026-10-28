import { createClient } from '@/lib/supabase/server'
import type { SupabaseMenuRow } from '@/lib/supabase/types'

interface TestResult {
  label: string
  passed: boolean
  detail: string
}

export default async function SupabaseTestPage() {
  const results: TestResult[] = []

  // ── Check 1: Environment variables are set ──────────────────────────
  const urlSet = !!process.env.NEXT_PUBLIC_SUPABASE_URL
  const keySet = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  results.push({
    label: 'Environment Variables',
    passed: urlSet && keySet,
    detail: urlSet && keySet
      ? 'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are configured.'
      : `Missing: ${[!urlSet && 'NEXT_PUBLIC_SUPABASE_URL', !keySet && 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter(Boolean).join(', ')}`,
  })

  // If env vars are missing, skip the remaining tests
  if (!urlSet || !keySet) {
    return <TestUI results={results} />
  }

  // ── Check 2: Supabase client can be created ─────────────────────────
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null
  try {
    supabase = await createClient()
    results.push({
      label: 'Client Creation',
      passed: true,
      detail: 'Supabase server client created successfully.',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    results.push({
      label: 'Client Creation',
      passed: false,
      detail: `Failed to create Supabase client: ${msg}`,
    })
    return <TestUI results={results} />
  }

  // ── Check 3: Read from the existing `menu` table ────────────────────
  try {
    const { data, error, count } = await supabase
      .from('menu')
      .select('*', { count: 'exact' })
      .limit(3)

    if (error) {
      results.push({
        label: 'Menu Table Read',
        passed: false,
        detail: `PostgREST error (${error.code}): ${error.message}`,
      })
    } else {
      const rows = (data ?? []) as SupabaseMenuRow[]
      const names = rows.map((r) => r.name).join(', ')
      results.push({
        label: 'Menu Table Read',
        passed: true,
        detail: `Successfully read ${count ?? rows.length} row(s). Sample: ${names || '(empty table)'}`,
      })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    results.push({
      label: 'Menu Table Read',
      passed: false,
      detail: `Unexpected error reading menu table: ${msg}`,
    })
  }

  return <TestUI results={results} />
}

// ─── Presentation ─────────────────────────────────────────────────────────

function TestUI({ results }: { results: TestResult[] }) {
  const allPassed = results.every((r) => r.passed)

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-sans">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold mb-2 text-gray-800">
          Supabase Connection Test
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Verifying the connection between Next.js and the existing Pabbas
          Supabase project.
        </p>

        {/* Overall status */}
        <div
          className={`p-4 rounded-xl mb-6 ${
            allPassed
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}
        >
          <p
            className={`font-semibold text-lg ${
              allPassed ? 'text-green-700' : 'text-red-700'
            }`}
          >
            {allPassed
              ? '✅ All checks passed — Supabase is connected!'
              : '❌ Some checks failed — see details below.'}
          </p>
        </div>

        {/* Individual results */}
        <ul className="space-y-4 mb-8">
          {results.map((r) => (
            <li
              key={r.label}
              className="bg-gray-50 rounded-xl p-4 border border-gray-100"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{r.passed ? '✅' : '❌'}</span>
                <strong className="text-gray-800 text-[15px]">
                  {r.label}
                </strong>
              </div>
              <p className="text-sm text-gray-600 ml-7">{r.detail}</p>
            </li>
          ))}
        </ul>

        <a
          href="/"
          className="inline-block w-full text-center bg-gray-800 hover:bg-gray-900 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
        >
          Return to App
        </a>
      </div>
    </div>
  )
}
