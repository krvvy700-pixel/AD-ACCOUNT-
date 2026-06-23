export const metadata = {
  title: 'Privacy Policy — AD Account',
  description: 'Privacy Policy for AD Account Meta Ads Manager',
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '60px 24px', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a', lineHeight: '1.7' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '700', marginBottom: '8px' }}>Privacy Policy</h1>
      <p style={{ color: '#666', marginBottom: '40px' }}>Last updated: June 2025</p>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>1. Overview</h2>
        <p>AD Account ("we", "our", or "the app") is a private Meta Ads management dashboard. This Privacy Policy explains how we collect, use, and protect data when you connect your Meta account to our application.</p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>2. Data We Collect</h2>
        <p>When you authenticate via Facebook Login, we collect:</p>
        <ul style={{ paddingLeft: '24px', marginTop: '8px' }}>
          <li>Your Facebook User ID and name</li>
          <li>Ad account IDs and campaign data you have permission to access</li>
          <li>Facebook Page access tokens for pages you manage</li>
          <li>Ad performance metrics (impressions, clicks, spend, conversions)</li>
          <li>Page comments and messages (only from pages you manage)</li>
        </ul>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>3. How We Use Your Data</h2>
        <p>We use your data solely to:</p>
        <ul style={{ paddingLeft: '24px', marginTop: '8px' }}>
          <li>Display your ad campaign performance in our dashboard</li>
          <li>Run automated rules to pause/resume ads based on your configured conditions</li>
          <li>Display and manage comments on your Facebook Pages and Instagram</li>
          <li>Show inbox messages from your Pages</li>
        </ul>
        <p style={{ marginTop: '12px' }}>We do <strong>not</strong> sell, share, or use your data for any advertising or third-party purposes.</p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>4. Data Storage</h2>
        <p>Your access tokens and ad account data are stored securely in our Supabase database with row-level security. Access tokens are encrypted and only used to make authorized API calls to Meta on your behalf.</p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>5. Data Retention</h2>
        <p>We retain your data for as long as you use the application. You may request deletion of your data at any time by contacting us. Upon deletion, all stored tokens and associated data are permanently removed from our systems.</p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>6. Facebook Permissions</h2>
        <p>Our app requests the following Meta permissions:</p>
        <ul style={{ paddingLeft: '24px', marginTop: '8px' }}>
          <li><strong>ads_read / ads_management</strong> — to view and manage your ad campaigns</li>
          <li><strong>pages_*</strong> — to read and manage your Facebook Pages</li>
          <li><strong>instagram_*</strong> — to manage Instagram comments and messages</li>
          <li><strong>read_insights</strong> — to display performance analytics</li>
        </ul>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>7. User Data Deletion</h2>
        <p>To request deletion of your data, please email us at <a href="mailto:aadityaaggarwal3526@gmail.com" style={{ color: '#1877f2' }}>aadityaaggarwal3526@gmail.com</a>. We will process your request within 30 days and confirm deletion.</p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>8. Security</h2>
        <p>We implement industry-standard security measures including HTTPS encryption, secure token storage, and role-based access control to protect your data.</p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>9. Contact</h2>
        <p>For any privacy-related questions, contact us at:<br />
        <a href="mailto:aadityaaggarwal3526@gmail.com" style={{ color: '#1877f2' }}>aadityaaggarwal3526@gmail.com</a></p>
      </section>
    </main>
  );
}
