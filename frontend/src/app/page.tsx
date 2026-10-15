import { SystemStatus } from "@/components/system-status";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">CryptoScope</h1>
        <p className="mt-2 text-neutral-500">
          Cryptographic inventory and quantum-risk assessment. The dashboard arrives in Step 8; for now
          this page shows whether the backend and its dependencies are healthy.
        </p>
      </header>
      <section>
        <h2 className="mb-4 text-lg font-medium">System status</h2>
        <SystemStatus />
      </section>
    </main>
  );
}
