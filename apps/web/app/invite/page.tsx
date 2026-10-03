import { Brand } from '../../components/brand';
import { Verify } from '../../components/verify';
export default function Invite() {
  return (
    <main id="main" className="auth-page">
      <Brand />
      <section className="auth-card">
        <h1>Your invitation.</h1>
        <p className="muted">Sign in with the email address this invitation was sent to.</p>
        <Verify invitation />
      </section>
    </main>
  );
}
