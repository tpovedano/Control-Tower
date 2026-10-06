import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { getSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <>
      <Nav user={session.user} />
      <main className="mx-auto max-w-[1600px] px-4 py-6">{children}</main>
    </>
  );
}
