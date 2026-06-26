import Link from 'next/link'

export default function Home() {
  return (
    <main>
      <h1>Calyxa</h1>
      <p>
        <Link href="/signup">Sign up</Link> · <Link href="/login">Log in</Link>
      </p>
    </main>
  )
}
