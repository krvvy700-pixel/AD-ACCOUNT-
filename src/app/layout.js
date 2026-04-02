import './globals.css';
import { CurrencyProvider } from '@/context/CurrencyContext';
import { AccountProvider } from '@/context/AccountContext';

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
            {children}
          </AccountProvider>
        </CurrencyProvider>
      </body>
    </html>
  );
}
