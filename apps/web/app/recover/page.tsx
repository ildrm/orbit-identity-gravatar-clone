import { Brand } from '../../components/brand';
import { AuthForm } from '../../components/auth-form';
export default function Recover() {
  return (
    <main id="main" className="auth-page">
      <Brand />
      <section className="auth-card">
        <h1>Recover your account.</h1>
        <p className="muted">We will send a short-lived recovery link to your verified address.</p>
        <AuthForm mode="recover" />
      </section>
    </main>
  );
}
