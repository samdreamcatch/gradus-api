import { createFileRoute, Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQuery } from '@tanstack/react-query'
import { zodValidator, fallback } from '@tanstack/zod-adapter'
import { z } from 'zod'
import { ArrowLeft } from 'lucide-react'
import { listAdminErrors } from '@/lib/error-tracking.functions'
import { Eyebrow } from '@/components/ui/eyebrow'
import { chipClasses } from '@/components/ui/chip'
import { cn } from '@/lib/utils'



const searchSchema = z.object({
  test: fallback(z.boolean(), false).default(false),
})

export const Route = createFileRoute('/_authenticated/admin/errors')({
  validateSearch: zodValidator(searchSchema),
  component: AdminErrors,
})

function AdminErrors() {
  const { test: includeTest } = Route.useSearch()
  const listFn = useServerFn(listAdminErrors)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-errors', includeTest],
    queryFn: () => listFn({ data: { limit: 200, includeTest } }),
  })

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="space-y-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-3.5" /> Back to admin
        </Link>
        <div>
          <Eyebrow size="small" tone="accent-ink">Internal</Eyebrow>
          <h1 className="font-display text-h1 text-text-primary">Errors</h1>
          <p className="text-text-secondary text-sm mt-1">
            Every captured error from the app, newest first. One row per occurrence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, test: !includeTest })}
            className={chipClasses({ tone: 'muted', selected: includeTest })}
          >
            {includeTest ? 'Test users: on' : 'Test users: hidden'}
          </Link>
        </div>


      </header>

      {isLoading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : !data?.items.length ? (
        <p className="text-text-secondary">No errors recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((e: any) => (
            <li key={e.id}>
              <Link
                to="/admin/errors/$id"
                params={{ id: e.id }}
                className="block rounded-lg border border-divider bg-card p-4 shadow-card hover:bg-elevated transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        e.source === 'server'
                          ? 'bg-pen-orange-wash text-pen-orange-ink'
                          : 'bg-pen-pool-wash text-pen-pool-ink',
                      )}
                    >
                      {e.source}
                    </span>
                    <span className="text-sm font-semibold text-text-primary truncate">
                      {e.message}
                    </span>
                  </div>
                  <span className="text-[11px] text-text-tertiary whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
                  {e.route && <span className="font-mono">{e.route}</span>}
                  <span>
                    {e.user_name || e.user_email || '(unauthenticated)'}
                    {e.user_role && ` · ${e.user_role}`}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
