import Link from "next/link";
import { LogoMark } from "@/components/brand/LogoMark";
import { SubscribeForm } from "./SubscribeForm";
import { c } from "./classes";

const COLUMNS = [
  { title: "Product", links: [["AI agents", "#agents"], ["Features", "#features"], ["Connectors", "#connectors"], ["Pricing", "#pricing"]] },
  { title: "Learn", links: [["Roadmap", "#roadmap"], ["FAQ", "#faq"], ["How it works", "#workflow"]] },
  { title: "Company", links: [["Founding merchants", "#founding"], ["Contact us", "#contact"]] },
  { title: "Account", links: [["Sign in", "/login"], ["Create a workspace", "/register"]] },
] as const;

/** The closing call to action and the footer, in one card. */
export function EndCard() {
  return (
    <section id="start" className={c("endsec")}>
      <div className={c("endcard")}>
        <div className={c("end-cta")}>
          <h2 className={c("h2")}>Ready to give your store a <span className={c("hl")}>calmer back office?</span></h2>
          <p className={c("lede")}>Orders, chats, stock and cash on delivery in one place. Set up your shop in minutes, free for small teams.</p>
          <div className={c("row center")}>
            <Link className={c("btn ink")} href="/register">Create your workspace</Link>
            <a className={c("btn ghost")} href="#contact">Contact us</a>
          </div>
        </div>

        <footer className={c("foot")} id="contact">
          <div className={c("foot-top")}>
            <div className={c("foot-brand")}>
              <a href="#top" className={c("brand-link")}>
                <LogoMark size={34} />
                CommerceOS
              </a>
              <p className={c("foot-title")}>Get product updates and early-access news.</p>
              <SubscribeForm />
            </div>
            <nav className={c("foot-cols")} aria-label="Footer">
              {COLUMNS.map((col) => (
                <div key={col.title}>
                  <h4>{col.title}</h4>
                  {col.links.map(([label, href]) =>
                    href.startsWith("/") ? (
                      <Link key={label} href={href}>{label}</Link>
                    ) : (
                      <a key={label} href={href}>{label}</a>
                    ),
                  )}
                </div>
              ))}
            </nav>
          </div>
          <div className={c("foot-bottom")}>
            <span>© {new Date().getFullYear()} CommerceOS. All rights reserved.</span>
            <span>Made by Kawshik</span>
          </div>
        </footer>
      </div>
    </section>
  );
}
