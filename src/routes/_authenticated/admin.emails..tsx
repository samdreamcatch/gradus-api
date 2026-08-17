
/** Manual push: send this template to a real user, or a test to support. */
function SendPanel({ name, role }: { name: string; role?: string }) {
  const search = useServerFn(searchEmailRecipients);
  const send = useServerFn(sendEmailManually);

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Array<{ id: string; email: string }>>([]);
  const [selected, setSelected] = React.useState<string>("");

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await search({ data: { query: query.trim() } });
        if (!cancelled) setResults(res);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, search]);

  const sendMutation = useMutation({
    mutationFn: (recipientEmail: string) => send({ data: { name, recipientEmail, role } }),
    onSuccess: (res: any) => toast.success(`Queued to ${res?.recipient ?? "recipient"}`),
    onError: (e: any) => toast.error(e?.message ?? "Could not send"),
  });

  return (
    <div className="rounded-lg border border-divider bg-card p-3 shadow-card space-y-3">
      <p className="text-caption uppercase tracking-widest text-text-tertiary">Send this email</p>

      <div className="space-y-2">
        <Input
          value={query}
          placeholder="Search users by email…"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected("");
          }}
        />
        {results.length > 0 && (
          <ul className="max-h-40 overflow-auto rounded-md border border-divider divide-y divide-divider">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`w-full px-2 py-1.5 text-left text-meta press-soft ${
                    selected === r.email ? "bg-elevated text-text-primary" : "text-text-secondary"
                  }`}
                  onClick={() => {
                    setSelected(r.email);
                    setQuery(r.email);
                  }}
                >
                  {r.email}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!selected || sendMutation.isPending}
          onClick={() => sendMutation.mutate(selected)}
        >
          Send to {selected || "selected user"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={sendMutation.isPending}
          onClick={() => sendMutation.mutate(TEST_EMAIL_ADDRESS)}
        >
          Send test to {TEST_EMAIL_ADDRESS}
        </Button>
      </div>

      <p className="text-meta text-text-secondary">
        Sends the saved copy (not unsaved edits){role ? `, as the ${role} version` : ""}. Goes
        through the normal email queue, so suppressed addresses are respected.
      </p>
    </div>
  );
}
