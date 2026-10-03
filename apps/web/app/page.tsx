import Link from 'next/link';
import { ArrowRight, ShieldCheck, Layers, Code2, Globe2 } from 'lucide-react';
import { Brand } from '../components/brand';
import { SearchProfiles } from '../components/search';
export default function Home() {
  return (
    <>
      <header className="public-header">
        <Brand />
        <nav aria-label="Main">
          <Link href="/developers">For developers</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/register" className="button primary compact">
            Get started <ArrowRight size={16} />
          </Link>
        </nav>
      </header>
      <main id="main">
        <section className="landing-hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="status-dot" /> OPEN IDENTITY, BY DESIGN
            </span>
            <h1>
              One identity.
              <br />
              <span>Your many sides.</span>
            </h1>
            <p className="lead">
              A home for who you are across the internet. Your profiles, your personas, your choice
              of what to share.
            </p>
            <div className="actions">
              <Link className="button primary" href="/register">
                Create your identity <ArrowRight size={18} />
              </Link>
              <Link className="text-link" href="/developers">
                Explore the API <ArrowUpIcon />
              </Link>
            </div>
            <p className="hero-note">
              <ShieldCheck size={16} /> Private by default. Portable by design.
            </p>
          </div>
          <div className="hero-product">
            <div className="sample-top">
              <span>THE SAME IDENTITY. DIFFERENT CONTEXTS.</span>
              <Layers size={18} />
            </div>
            <div className="persona-demo">
              <img
                src="/avatar/orbit-identity?size=256"
                alt="An original deterministic geometric avatar"
                width={104}
                height={104}
              />
              <div>
                <span className="eyebrow">PERMANENT IDENTITY</span>
                <h2>Your identity</h2>
                <p>A stable home. Room to grow.</p>
              </div>
            </div>
            <div className="demo-context">
              <span className="context-icon">
                <Globe2 size={20} />
              </span>
              <div>
                <strong>Personal</strong>
                <p>Share what matters to you.</p>
              </div>
              <span className="tag">Your choice</span>
            </div>
            <div className="demo-context">
              <span className="context-icon">
                <Code2 size={20} />
              </span>
              <div>
                <strong>Professional</strong>
                <p>Bring your work into focus.</p>
              </div>
              <span className="tag">Your choice</span>
            </div>
            <div className="demo-footer">
              <ShieldCheck size={16} /> You decide which fields each application sees.
            </div>
          </div>
        </section>
        <section className="discovery-section">
          <div>
            <span className="eyebrow">DISCOVER</span>
            <h2>Find people. Respect their privacy.</h2>
            <p className="muted">Search identities that have chosen to be discoverable.</p>
          </div>
          <SearchProfiles />
        </section>
        <section className="principle-grid">
          <article>
            <Layers />
            <h3>Many personas. One you.</h3>
            <p>Keep a personal and professional presence with a permanent identity behind both.</p>
          </article>
          <article>
            <ShieldCheck />
            <h3>Share with intention.</h3>
            <p>
              Control each field, understand its source, and revoke application access whenever you
              choose.
            </p>
          </article>
          <article>
            <Code2 />
            <h3>Built to connect.</h3>
            <p>
              Use the native API, generated avatars, and portable identity exports in your own
              tools.
            </p>
          </article>
        </section>
      </main>
      <footer className="public-footer">
        <Brand />
        <span>Identity belongs to you.</span>
        <Link href="/developers">Developer documentation</Link>
      </footer>
    </>
  );
}
function ArrowUpIcon() {
  return <span aria-hidden="true">↗</span>;
}
