import { Brand } from '../../components/brand';
import { Verify } from '../../components/verify';
export default function Verification() {
  return (
    <main id="main" className="auth-page">
      <Brand />
      <section className="auth-card">
        <h1>Verify your email.</h1>
        <Verify />
      </section>
    </main>
  );
}
