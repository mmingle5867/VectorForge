import { SignUp } from '@clerk/nextjs';
import config from '@/lib/config';

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">{config.identity.displayName}</h1>
          <p className="mt-2 text-gray-600">Create your account</p>
        </div>
        <SignUp
          appearance={{
            elements: {
              rootBox: 'mx-auto',
              card: 'shadow-lg border border-gray-200',
            },
          }}
        />
      </div>
    </div>
  );
}
