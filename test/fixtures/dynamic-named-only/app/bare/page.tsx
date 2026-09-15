export default async function BarePage() {
  const widgets = await import('../../src/widgets');
  return <widgets.Used />;
}
