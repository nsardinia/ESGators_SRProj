import { useEffect, useMemo, useState } from "react"
import { Card, CardContent } from "../components/ui/card"
import Button from "../components/ui/button"

const documentationLinks = [
  {
    label: "Documentation Home",
    href: "/docs/",
    description: "Project overview, local setup notes, and the main docs landing page.",
  },
  {
    label: "Backend API Docs",
    href: "/docs/backend-api/",
    description: "Service architecture, endpoints, and generated API documentation references.",
  },
  {
    label: "Frontend Structure",
    href: "/docs/frontend-structure/",
    description: "Frontend organization, routing, and UI architecture notes.",
  },
]

const hardwareOptions = [
  {
    id: "radio-enabled-node",
    title: "Radio-Enabled Node",
    subtitle: "Long-range environmental monitoring package",
    status: "Available now",
    summary:
      "Built around an Arduino Nano ESP32 with a LoRa radio stack and onboard air quality, gas, and noise sensing.",
    specs: [
      "Arduino Nano ESP32",
      "Adafruit LoRa module",
      "PMS5003 particulate matter sensor",
      "DFRobot NO2 sensor",
      "DFRobot analog sound sensor",
    ],
    sensors: [
      "Air particulate monitoring for PM concentration trends",
      "Nitrogen dioxide sensing for localized pollutant tracking",
      "Analog acoustic sensing for environmental sound level sampling",
    ],
    links: [
      {
        label: "Further information",
        href: "https://www.adafruit.com/",
        description: "Datasheets, specs, and ordering references for the node components.",
      },
      {
        label: "3D print files (.stp)",
        href: "https://grabcad.com/library",
        description: "GrabCAD download location for enclosure and hardware print assets.",
      },
      {
        label: "Firmware GitHub",
        href: "https://github.com/",
        description: "Placeholder repository for open-source firmware and flashing instructions.",
      },
    ],
  },
  {
    id: "wireless-node",
    title: "Wireless Node",
    subtitle: "Environmental monitoring package without long-range radio",
    status: "Available now",
    summary:
      "Built around an Arduino Nano ESP32 with a simplified sensing stack focused on gas and sound monitoring.",
    specs: [
      "Arduino Nano ESP32",
      "DFRobot NO2 sensor",
      "DFRobot analog sound sensor",
    ],
    sensors: [
      "Nitrogen dioxide sensing for localized pollutant tracking",
      "Analog acoustic sensing for environmental sound level sampling",
    ],
    links: [
      {
        label: "Further information",
        href: "https://www.dfrobot.com/",
        description: "Datasheets, specs, and ordering references for the node components.",
      },
      {
        label: "3D print files (.stp)",
        href: "https://grabcad.com/library",
        description: "GrabCAD download location for enclosure and hardware print assets.",
      },
      {
        label: "Firmware GitHub",
        href: "https://github.com/",
        description: "Placeholder repository for open-source firmware and flashing instructions.",
      },
    ],
  },
]

function HardwareDetailModal({ option, onClose }) {
  useEffect(() => {
    if (!option) return undefined

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose, option])

  if (!option) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,10,18,0.74)] px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <Card
        className="max-h-[90vh] w-full max-w-[760px] overflow-hidden border-[rgba(96,165,250,0.22)] bg-[#111827]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${option.id}-title`}
      >
        <CardContent className="space-y-6 p-0">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
            <div>
              <p className="mb-2 text-[0.8rem] font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">
                {option.status}
              </p>
              <h2 id={`${option.id}-title`} className="text-[1.45rem] font-semibold text-[var(--text)]">
                {option.title}
              </h2>
              <p className="mt-2 max-w-[60ch] text-sm text-[var(--muted)]">{option.summary}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close hardware details">
              Close
            </Button>
          </div>

          <div className="max-h-[calc(90vh-120px)] overflow-y-auto px-6 pb-6">
            <div className="mb-6 grid gap-4 md:grid-cols-[1.2fr_1fr]">
              <div className="flex min-h-[220px] items-center justify-center rounded-[18px] border border-dashed border-[rgba(148,163,184,0.32)] bg-[linear-gradient(135deg,rgba(30,41,59,0.92),rgba(17,24,39,0.96))] px-6 text-center text-sm text-[var(--muted)]">
                TODO
              </div>
              <div className="rounded-[18px] border border-[rgba(96,165,250,0.18)] bg-[rgba(15,23,42,0.82)] p-5">
                <p className="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-[#93c5fd]">
                  Node Overview
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">TODO</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[18px] border border-[var(--border)] bg-[rgba(15,23,42,0.72)] p-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--text)]">
                  Hardware Specs
                </h3>
                <ul className="mt-4 space-y-3 text-sm text-[var(--muted)]">
                  {option.specs.map((item) => (
                    <li key={item} className="rounded-[12px] border border-[rgba(148,163,184,0.16)] px-3 py-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-[18px] border border-[var(--border)] bg-[rgba(15,23,42,0.72)] p-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--text)]">
                  Sensors And Notes
                </h3>
                <ul className="mt-4 space-y-3 text-sm text-[var(--muted)]">
                  {option.sensors.map((item) => (
                    <li key={item} className="rounded-[12px] border border-[rgba(148,163,184,0.16)] px-3 py-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 rounded-[18px] border border-[var(--border)] bg-[rgba(15,23,42,0.72)] p-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--text)]">
                Links And Downloads
              </h3>
              <div className="mt-4 grid gap-3">
                {option.links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target={link.href === "#" ? undefined : "_blank"}
                    rel={link.href === "#" ? undefined : "noreferrer"}
                    className="rounded-[14px] border border-[rgba(96,165,250,0.16)] bg-[rgba(30,41,59,0.58)] px-4 py-3 transition-colors hover:border-[rgba(96,165,250,0.36)] hover:bg-[rgba(37,99,235,0.08)]"
                  >
                    <p className="text-sm font-semibold text-[#bfdbfe]">{link.label}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{link.description}</p>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function HardwarePage() {
  const [selectedId, setSelectedId] = useState(null)

  const selectedOption = useMemo(
    () => hardwareOptions.find((option) => option.id === selectedId) ?? null,
    [selectedId]
  )

  return (
    <section className="max-w-[1040px]">
      <p className="mb-[10px] pt-2 text-base font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
        Device Information
      </p>
      <h1 className="mb-2 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold text-[var(--text)]">Available Hardware</h1>
      <div className="mb-5 rounded-[18px] border border-[rgba(96,165,250,0.18)] bg-[linear-gradient(135deg,rgba(15,23,42,0.92),rgba(30,41,59,0.88))] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[60ch]">
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">
              Documentation
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Need setup steps, architecture notes, or API references while working with hardware? Open the project docs directly from here.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {documentationLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-[14px] border border-[rgba(96,165,250,0.16)] bg-[rgba(15,23,42,0.72)] px-4 py-3 transition-colors hover:border-[rgba(96,165,250,0.36)] hover:bg-[rgba(37,99,235,0.08)]"
            >
              <p className="text-sm font-semibold text-[#bfdbfe]">{link.label}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{link.description}</p>
            </a>
          ))}
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {hardwareOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setSelectedId(option.id)}
            className="rounded-[14px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(96,165,250,0.34)]"
          >
            <Card className="group h-full overflow-hidden border-[rgba(96,165,250,0.14)] transition duration-200 hover:-translate-y-1 hover:border-[rgba(96,165,250,0.34)] hover:shadow-[0_22px_50px_rgba(8,15,30,0.42)]">
              <CardContent className="p-0">
                <div className="flex min-h-[220px] items-center justify-center border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,41,59,0.88))] px-6 text-center text-sm text-[var(--muted)]">
                  TODO
                </div>
                <div className="space-y-4 p-5">
                  <div>
                    <p className="mb-2 text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">
                      {option.status}
                    </p>
                    <h2 className="text-[1.15rem] font-semibold text-[var(--text)]">{option.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{option.subtitle}</p>
                  </div>
                  <p className="text-sm leading-6 text-[var(--muted)]">{option.summary}</p>
                  <div className="flex items-center justify-between border-t border-[rgba(148,163,184,0.14)] pt-4">
                    <span className="text-sm font-medium text-[#bfdbfe]">View specifications</span>
                    <span className="text-sm text-[var(--muted)] group-hover:text-[var(--text)]">Open popup</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <HardwareDetailModal option={selectedOption} onClose={() => setSelectedId(null)} />
    </section>
  )
}

export default HardwarePage
