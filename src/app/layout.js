import './globals.css';
import { CurrencyProvider } from '@/context/CurrencyContext';
import { AccountProvider } from '@/context/AccountContext';
import { AuthProvider } from '@/context/AuthContext';

export const metadata = {
  title: 'Meta Ads Analytics — Dashboard',
  description: 'Unified Meta Ads analytics dashboard with campaign automation',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <CurrencyProvider>
          <AccountProvider>
            <AuthProvider>
              {children}
            </AuthProvider>
          </AccountProvider>
        </CurrencyProvider>
      </body>
    </html>
  );
}
