import { Brand } from '../../components/brand';
import { AuthForm } from '../../components/auth-form';
export default function Login() {
  return (
    <main id="main" className="auth-page">
      <Brand />
      <section className="auth-card">
        <span className="eyebrow">WELCOME BACK</span>
        <h1>Your identity starts here.</h1>
        <p className="muted">Sign in to manage what you share.</p>
        <AuthForm />
      </section>
      <p className="auth-footer">Private by default. Always yours.</p>
    </main>
  );
}
