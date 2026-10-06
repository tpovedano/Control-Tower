import { CargarView } from "./view";

export const metadata = { title: "Cargar · Procore Control Tower" };

export default function Page() {
  const maxRows = Number(process.env.MAX_ROWS_PER_BATCH ?? 500);
  return <CargarView maxRows={maxRows} />;
}
