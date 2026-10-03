import { Brand } from '../../components/brand';
import { AuthForm } from '../../components/auth-form';
export default function Reset() {
  return (
    <main id="main" className="auth-page">
      <Brand />
      <section className="auth-card">
        <h1>Choose a new password.</h1>
        <p className="muted">Changing it will sign out your existing sessions.</p>
        <AuthForm mode="reset" />
      </section>
    </main>
  );
}
