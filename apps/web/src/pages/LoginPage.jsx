import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@fraudlens/shared/schemas';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Field, Input, Notice, Spinner } from '../components/ui/index.jsx';

/**
 * Sign-in page.
 *
 * The form validates with the same Zod schema the API uses, so the client and
 * the server cannot disagree about what a well-formed credential looks like.
 * The error shown for a rejected sign-in is whatever the API said — which is
 * deliberately the same message for an unknown address and a wrong password, so
 * the page does not reveal which addresses are registered.
 */
export function LoginPage() {
  const { isAuthenticated, isRestoring, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitError, setSubmitError] = useState(null);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    setFocus('email');
  }, [setFocus]);

  if (isRestoring) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Restoring your session" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={location.state?.from ?? '/'} replace />;
  }

  const onSubmit = async (values) => {
    setSubmitError(null);
    try {
      await login(values);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (error) {
      setSubmitError(error.message);
    }
  };

  return (
    <div className="grid h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-accent/15 ring-1 ring-accent/30">
            <ShieldAlert className="h-5 w-5 text-accent" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-fg">FraudLens</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Transaction risk monitoring and investigation
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="panel space-y-4 p-6" noValidate>
          {submitError ? <Notice tone="error">{submitError}</Notice> : null}

          <Field label="Email address" error={errors.email?.message} htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              invalid={Boolean(errors.email)}
              {...register('email')}
            />
          </Field>

          <Field label="Password" error={errors.password?.message} htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              invalid={Boolean(errors.password)}
              {...register('password')}
            />
          </Field>

          <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
            Sign in
          </Button>
        </form>

        <p className="mt-5 text-center text-2xs leading-relaxed text-fg-faint">
          FraudLens analyses synthetic transaction data for investigation purposes. It does not
          connect to a payment network and does not block payments.
        </p>
        <p className="mt-2 text-center text-2xs leading-relaxed text-fg-faint">
          Local development accounts are created by <code className="font-mono">npm run seed</code>.
          See the README for their addresses.
        </p>
      </div>
    </div>
  );
}
