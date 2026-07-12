import { createFileRoute, Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Eyebrow } from '@/components/ui/eyebrow'
import { getAdminError } from '@/lib/error-tracking.functions'

export const Route = createFileRoute('/_authenticated/admin/errors/$id')({
  component: AdminErrorDetail,
})

function AdminErrorDetail() {
  const { id } = Route.useParams()
  const fn = useServerFn(getAdminError)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-error', id],
    queryFn: () => fn({ data: { id } }),
  })

  const e = data?.error as any

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <Link
        to="/admin/errors"
        search={{ test: false }}
        className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" /> Back to errors
      </Link>

      {isLoading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : !e ? (
        <p className="text-text-secondary">Error not found.</p>
      ) : (
        <>
          <header className="space-y-2">
            <span
              className={
                'inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ' +
                (e.source === 'server'
                  ? 'bg-pen-orange-wash text-pen-orange-ink'
                  : 'bg-pen-pool-wash text-pen-pool-ink')
              }
            >
              {e.source}
            </span>
            <h1 className="font-display text-h2 text-text-primary">{e.message}</h1>
            <p className="text-xs text-text-tertiary">
              {new Date(e.created_at).toLocaleString()}
            </p>
          </header>

          <section className="rounded-lg border border-divider bg-card p-4 space-y-2">
            <Row label="User" value={e.user_name || '—'} />
            <Row label="Email" value={e.user_email || '—'} />
            <Row label="Role" value={e.user_role || '—'} />
            <Row label="User ID" value={e.user_id || '—'} mono />
            <Row label="Route" value={e.route || '—'} mono />
            <Row label="User agent" value={e.user_agent || '—'} />
          </section>

          {e.stack && (
            <section>
              <Eyebrow size="small" tone="secondary" className="mb-2">
                Stack
              </Eyebrow>
              <pre className="rounded-lg bg-surface-code-block text-surface-code-block-foreground p-4 text-caption leading-relaxed overflow-auto whitespace-pre-wrap">
                {e.stack}
              </pre>
            </section>
          )}

          {e.metadata && Object.keys(e.metadata).length > 0 && (
            <section>
              <Eyebrow size="small" tone="secondary" className="mb-2">
                Metadata
              </Eyebrow>
              <pre className="rounded-lg border border-divider bg-elevated p-4 text-[11px] leading-relaxed overflow-auto whitespace-pre-wrap">
                {JSON.stringify(e.metadata, null, 2)}
              </pre>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 text-sm">
      <Eyebrow as="span" size="caption" tone="tertiary" weight="normal" tracking="wide" className="w-24 shrink-0 pt-0.5">
        {label}
      </Eyebrow>
      <span
        className={
          'text-text-primary break-all ' + (mono ? 'font-mono text-xs' : '')
        }
      >
        {value}
      </span>
    </div>
  )
}
