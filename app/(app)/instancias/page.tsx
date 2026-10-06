import { Suspense } from "react";
import { InstanciasView } from "./view";

export const metadata = { title: "Instancias · Procore Control Tower" };

export default function Page() {
  return (
    <Suspense>
      <InstanciasView />
    </Suspense>
  );
}
