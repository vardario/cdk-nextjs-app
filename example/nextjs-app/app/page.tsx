import Image from "next/image";
import image from "../assets/test.jpg";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <article className="m-auto">
        <h1 className="text-center">Hello,World</h1>
        <Image src={image} width={512} alt="An awesome image" />
      </article>
    </main>
  );
}
