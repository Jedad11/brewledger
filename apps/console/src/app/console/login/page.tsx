import { LoginForm } from "./LoginForm";

export default async function LoginPage(props: PageProps<"/console/login">) {
  const params = await props.searchParams;
  const nextRaw = params.next;
  const next = typeof nextRaw === "string" ? nextRaw : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-cream px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-xs uppercase tracking-[0.24px] text-ink-muted">
            Brew Ledger
          </span>
          <h1 className="mt-2 font-serif text-3xl font-bold leading-[1.35] text-ink">
            เข้าสู่ระบบ
          </h1>
          <p className="mt-2 text-base leading-[1.5] text-ink-muted text-pretty">
            สำหรับเจ้าของร้าน — ใช้เบอร์โทรศัพท์แทนรหัสผ่าน
          </p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
