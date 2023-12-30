export const dynamic = 'force-dynamic';

export default async function Time() {
  const response = await fetch('http://worldtimeapi.org/api/timezone/Europe/Berlin');
  const data = await response.json();

  return (
    <main className="min-h-screen flex">
      <section className="m-auto">
        <h1>Time</h1>
        <p>{data.datetime}</p>
      </section>
    </main>
  );
}
