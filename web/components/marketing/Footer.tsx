import Link from 'next/link'

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-3">
            <img src="/logo.svg" alt="Calyxa" className="h-6 w-auto self-start" />
            <p className="m-0 text-sm text-muted-foreground">Stop asking AI for answers. Start learning from it.</p>
          </div>
          <div className="flex gap-16 text-sm">
            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">Product</span>
              <a href="#session-showcase" className="text-muted-foreground hover:text-foreground">
                See it work
              </a>
              <a href="#pricing" className="text-muted-foreground hover:text-foreground">
                Pricing
              </a>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">Account</span>
              <Link href="/login" className="text-muted-foreground hover:text-foreground">
                Log in
              </Link>
              <Link href="/signup" className="text-muted-foreground hover:text-foreground">
                Sign up
              </Link>
            </div>
          </div>
        </div>
        <p className="mt-12 text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} Calyxa. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
