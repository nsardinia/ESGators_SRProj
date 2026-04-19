/**
 * Billing page shell
 *
 * Last Edit: Nicholas Sardinia, 4/19/2026
 */
import Button from "../../components/ui/button"
import { Card, CardContent } from "../../components/ui/card"

function BillingPage() {
  return (
    <section className="max-w-[900px]">
      <h1 className="mb-2 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold">Billing</h1>
      <p className="mb-[18px] text-base font-medium text-[var(--muted)]">Manage plans, invoices, and payment methods.</p>

      <Card className="mb-[14px] shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[6px] text-base font-semibold">Current Plan</h2>
          <p className="mb-[14px] text-[0.92rem] text-[var(--muted)]">TODO Plans</p>
          <div className="mb-[14px] flex gap-2">
            <span className="rounded-full border border-[rgba(62,207,142,0.36)] bg-[rgba(62,207,142,0.12)] px-[10px] py-1.5 text-[0.8rem] text-[#d3f5e4]">Plan Info</span>
            <span className="rounded-full border border-[#2b3549] bg-[#141a27] px-[10px] py-1.5 text-[0.8rem] text-[var(--muted)]">$TBD/request</span>
          </div>
          <Button type="button">Manage subscription</Button>
        </CardContent>
      </Card>

      <Card className="mb-[14px] shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[6px] text-base font-semibold">Payment Method</h2>
          <p className="mb-[14px] text-[0.92rem] text-[var(--muted)]">TODO Charge Info</p>
          <Button type="button" variant="secondary">Update card</Button>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[10px] text-base font-semibold">Recent Invoices</h2>
          <div className="overflow-hidden rounded-[10px] border border-[#273042]">
            <div className="flex justify-between gap-2 px-3 py-2.5 text-[0.9rem] text-[var(--muted)]"><span>INV-2026-0215</span><span>$TODO</span></div>
            <div className="flex justify-between gap-2 border-t border-[#273042] px-3 py-2.5 text-[0.9rem] text-[var(--muted)]"><span>INV-2026-0115</span><span>$TODO</span></div>
            <div className="flex justify-between gap-2 border-t border-[#273042] px-3 py-2.5 text-[0.9rem] text-[var(--muted)]"><span>INV-2025-1215</span><span>$TODO</span></div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export default BillingPage
