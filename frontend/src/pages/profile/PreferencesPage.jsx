/**
 * User preferences page shell
 *
 * Last Edit: Nicholas Sardinia, 4/19/2026
 */
import { Card, CardContent } from "../../components/ui/card"

function PreferencesPage() {
  return (
    <section className="max-w-[900px]">
      <h1 className="mb-2 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold">Preferences</h1>
      <p className="mb-[18px] text-base font-medium text-[var(--muted)]">Tune dashboard defaults and notification behavior.</p>

      <Card className="mb-[14px] shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[6px] text-base font-semibold">Display</h2>
          <p className="mb-[14px] text-[0.92rem] text-[var(--muted)]">Control defaults for your workspace experience.</p>
          <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
            <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
              <span>Default project</span>
              <select className="flex h-11 w-full rounded-[10px] border border-[#2b3549] bg-[#0e131d] px-3 py-2 text-sm text-[var(--text)] outline-none transition-colors focus:border-[rgba(62,207,142,0.45)]">
                <option>Production Monitoring</option>
              </select>
            </label>
            <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
              <span>Timezone</span>
              <select className="flex h-11 w-full rounded-[10px] border border-[#2b3549] bg-[#0e131d] px-3 py-2 text-sm text-[var(--text)] outline-none transition-colors focus:border-[rgba(62,207,142,0.45)]">
                <option>America/New_York</option>
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardContent className="p-[18px]">
          <h2 className="mb-[6px] text-base font-semibold">Notifications</h2>
          <p className="mb-[14px] text-[0.92rem] text-[var(--muted)]">Choose how you are notified about incidents and billing updates.</p>
          <div className="flex flex-col gap-[10px]">
            <label className="flex items-center justify-between text-[0.92rem]">
              <span>Email alerts</span>
              <input type="checkbox" className="accent-[var(--accent)]" defaultChecked />
            </label>
            <label className="flex items-center justify-between text-[0.92rem]">
              <span>Deployment digests</span>
              <input type="checkbox" className="accent-[var(--accent)]" />
            </label>
            <label className="flex items-center justify-between text-[0.92rem]">
              <span>Billing reminders</span>
              <input type="checkbox" className="accent-[var(--accent)]" defaultChecked />
            </label>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export default PreferencesPage
