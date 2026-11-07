import OfficeClient from "./OfficeClient";

export default async function OfficePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfficeClient agentId={Number(id)} />;
}
