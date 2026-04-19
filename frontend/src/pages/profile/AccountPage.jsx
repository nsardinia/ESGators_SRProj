/**
 * Account management page shell.
 *
 *
 * Last Edit: Nicholas Sardinia, 4/19/2026
 */

import Button from "../../components/ui/button"
import { Card, CardContent } from "../../components/ui/card"
import Input from "../../components/ui/input"
import Textarea from "../../components/ui/textarea"

function AccountPage() {
  return (
    <section className="max-w-[900px]">
      <h1 className="mb-2 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold">Account</h1>
      <p className="mb-[18px] text-base font-medium text-[var(--muted)]">TODO Account Info</p>

      <Card className="mb-[14px] shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[6px] text-base font-semibold">Profile Details</h2>
          <p className="mb-[14px] text-[0.92rem] text-[var(--muted)]">Todo Profile Details</p>
          <div className="mb-3 grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
            <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
              <span>Full name</span>
              <Input type="text" placeholder="Nicholas Sardinia" />
            </label>
            <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
              <span>Username</span>
              <Input type="text" placeholder="nicholas" />
            </label>
            <label className="col-span-2 flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)] max-[900px]:col-span-1">
              <span>Email</span>
              <Input type="email" placeholder="nicholas@esgators.io" />
            </label>
            <label className="col-span-2 flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)] max-[900px]:col-span-1">
              <span>Bio</span>
              <Textarea rows="4" placeholder="Building IoT-first sustainability tools for companies and investors." />
            </label>
          </div>
          <Button type="button">Save changes</Button>
        </CardContent>
      </Card>

      <Card className="border-[rgba(248,113,113,0.32)] shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[6px] text-base font-semibold">Delete Account</h2>
          <p className="mb-[14px] text-[0.92rem] text-[var(--muted)]">Permanently delete your account</p>
          <Button type="button" variant="destructive">Delete account</Button>
        </CardContent>
      </Card>
    </section>
  )
}

export default AccountPage
