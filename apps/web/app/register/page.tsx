import { Brand } from '../../components/brand';
import { AuthForm } from '../../components/auth-form';
export default function Register() {
  return (
    <main id="main" className="auth-page">
      <Brand />
      <section className="auth-card">
        <span className="eyebrow">MAKE IT YOURS</span>
        <h1>A home for your identity.</h1>
        <p className="muted">
          Create an account, verify your email, then choose your first identity.
        </p>
        <AuthForm mode="register" />
      </section>
    </main>
  );
}
