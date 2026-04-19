/**
 * Security management shell.
 *
 * Last Edit: Nicholas Sardinia, 4/19/2026
 */
import Button from "../../components/ui/button"
import { Card, CardContent } from "../../components/ui/card"

function SecurityPage() {
  return (
    <section className="max-w-[900px]">
      <h1 className="mb-2 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold">Security</h1>
      <p className="mb-[18px] text-base font-medium text-[var(--muted)]">Protect your account with strong authentication settings.</p>

      <Card className="mb-[14px] shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[6px] text-base font-semibold">Password</h2>
          <p className="mb-[14px] text-[0.92rem] text-[var(--muted)]">TODO enable password changes</p>
          <Button type="button" variant="secondary">Change password</Button>
        </CardContent>
      </Card>

      <Card className="mb-[14px] shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[6px] text-base font-semibold">TODO 2FA</h2>
          <p className="mb-[14px] text-[0.92rem] text-[var(--muted)]">2FA is currently disabled for this account.</p>
          <Button type="button">Enable 2FA</Button>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[10px] text-base font-semibold">Active Sessions</h2>
          <div className="overflow-hidden rounded-[10px] border border-[#273042]">
            <div className="flex justify-between gap-2 px-3 py-2.5 text-[0.9rem] text-[var(--muted)]"><span>TODO fetch session info</span><span>TODO store sessions</span></div>
            <div className="flex justify-between gap-2 border-t border-[#273042] px-3 py-2.5 text-[0.9rem] text-[var(--muted)]"><span>TODO fetch session info</span><span>TODO store sessions</span></div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export default SecurityPage
