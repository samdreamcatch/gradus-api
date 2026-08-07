const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full border-b border-red-300 bg-red-100 px-4 py-2 text-center text-sm text-red-800">
        Production checkout is not configured. Complete Stripe go-live in your Lovable project to
        accept real payments.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full border-b border-orange-300 bg-orange-100 px-4 py-2 text-center text-sm text-orange-800">
        Payments are in test mode — use card 4242 4242 4242 4242 to try checkout.
      </div>
    );
  }
  return null;
}
