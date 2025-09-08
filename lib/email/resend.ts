import { Resend } from 'resend';
import { formatDateTime } from '@/lib/datetime'

// Initialize Resend client with fallback for missing API key
const resend = new Resend(process.env.RESEND_API_KEY || 'placeholder_api_key');

export interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

// Email templates
export const emailTemplates = {
  welcome: (data: { name: string; pubName: string }): EmailTemplate => ({
    subject: "Welcome to CheersAI! 🥂",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #1a1a1a; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e5e5e5; border-radius: 0 0 12px 12px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #ea580c; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #ea580c; margin: 0;">Welcome to CheersAI!</h1>
            </div>
            <div class="content">
              <h2>Hi ${data.name}! 👋</h2>
              <p>Welcome aboard! We're thrilled to have <strong>${data.pubName}</strong> join the CheersAI family.</p>
              <p>Your 14-day free trial has started, giving you full access to:</p>
              <ul>
                <li>AI-powered content generation</li>
                <li>Social media scheduling</li>
                <li>Campaign management</li>
                <li>Media library</li>
              </ul>
              <p>Ready to create your first campaign?</p>
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" class="button">Go to Dashboard</a>
              <p>If you have any questions, just reply to this email!</p>
              <p>Cheers,<br>The CheersAI Team</p>
            </div>
            <div class="footer">
              <p>© CheersAI - AI-Powered Marketing for Hospitality</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Welcome to CheersAI, ${data.name}! Your 14-day free trial has started.`
  }),

  passwordReset: (data: { resetUrl: string }): EmailTemplate => ({
    subject: "Reset your CheersAI password",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #1a1a1a; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #f9fafb; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e5e5e5; border-radius: 0 0 12px 12px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #ea580c; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #1a1a1a; margin: 0;">Password Reset Request</h1>
            </div>
            <div class="content">
              <p>You requested to reset your password. Click the button below to create a new password:</p>
              <a href="${data.resetUrl}" class="button">Reset Password</a>
              <p style="color: #666; font-size: 14px;">This link will expire in 1 hour for security reasons.</p>
              <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
            </div>
            <div class="footer">
              <p>© CheersAI - AI-Powered Marketing for Hospitality</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Reset your password: ${data.resetUrl}`
  }),

  passwordChanged: (data: { changedAt: string }): EmailTemplate => ({
    subject: "Your password has been changed",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #1a1a1a; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .alert { background: #fef2f2; border: 1px solid #fecaca; padding: 20px; border-radius: 8px; }
            .content { background: white; padding: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h2>Password Changed Successfully</h2>
              <p>Your CheersAI password was changed on ${formatDateTime(data.changedAt)}.</p>
              <div class="alert">
                <p><strong>⚠️ If you didn't make this change:</strong></p>
                <p>Please contact us immediately at support@cheersai.orangejelly.co.uk</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Your password was changed on ${formatDateTime(data.changedAt)}`
  }),

  postPublished: (data: { campaignName: string; platform: string; publishedAt: string }): EmailTemplate => ({
    subject: `✅ Post published to ${data.platform}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #1a1a1a; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .success { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 8px; }
            .button { display: inline-block; padding: 10px 20px; background-color: #ea580c; color: white; text-decoration: none; border-radius: 6px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">
              <h2>🎉 Successfully Published!</h2>
              <p><strong>Campaign:</strong> ${data.campaignName}</p>
              <p><strong>Platform:</strong> ${data.platform}</p>
              <p><strong>Published at:</strong> ${data.publishedAt}</p>
            </div>
            <p style="margin-top: 20px;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/campaigns" class="button">View Campaigns</a>
            </p>
          </div>
        </body>
      </html>
    `,
    text: `Post published to ${data.platform} for campaign: ${data.campaignName}`
  }),

  postFailed: (data: { campaignName: string; platform: string; error: string }): EmailTemplate => ({
    subject: `❌ Failed to publish to ${data.platform}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #1a1a1a; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .error { background: #fef2f2; border: 1px solid #fecaca; padding: 20px; border-radius: 8px; }
            .button { display: inline-block; padding: 10px 20px; background-color: #ea580c; color: white; text-decoration: none; border-radius: 6px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error">
              <h2>⚠️ Publishing Failed</h2>
              <p><strong>Campaign:</strong> ${data.campaignName}</p>
              <p><strong>Platform:</strong> ${data.platform}</p>
              <p><strong>Error:</strong> ${data.error}</p>
            </div>
            <p style="margin-top: 20px;">We'll automatically retry, or you can manually retry from your dashboard.</p>
            <p>
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/campaigns" class="button">Go to Campaigns</a>
            </p>
          </div>
        </body>
      </html>
    `,
    text: `Failed to publish to ${data.platform}: ${data.error}`
  }),

  trialEnding: (data: { daysLeft: number; pubName: string }): EmailTemplate => ({
    subject: `⏰ Only ${data.daysLeft} days left in your CheersAI trial`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #1a1a1a; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .warning { background: #fef3c7; border: 1px solid #fde68a; padding: 20px; border-radius: 8px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #ea580c; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .features { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="warning">
              <h2>⏰ Your trial ends in ${data.daysLeft} days!</h2>
              <p>Don't lose access to your campaigns and content for <strong>${data.pubName}</strong>.</p>
            </div>
            <div class="features">
              <h3>Continue enjoying:</h3>
              <ul>
                <li>Unlimited campaigns</li>
                <li>500 AI posts per month</li>
                <li>Advanced scheduling</li>
                <li>Priority support</li>
              </ul>
            </div>
            <p style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings/billing" class="button">Upgrade Now - Save 20%</a>
            </p>
            <p style="color: #666; font-size: 14px; text-align: center;">
              Special offer: Use code CHEERS20 for 20% off your first 3 months!
            </p>
          </div>
        </body>
      </html>
    `,
    text: `Your CheersAI trial ends in ${data.daysLeft} days. Upgrade now to keep access!`
  }),

  scheduledReminder: (data: { campaignName: string; platform: string; scheduledTime: string; content: string }): EmailTemplate => ({
    subject: `📅 Reminder: Post scheduled for ${data.scheduledTime}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #1a1a1a; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .reminder { background: #eff6ff; border: 1px solid #bfdbfe; padding: 20px; border-radius: 8px; }
            .preview { background: white; border: 1px solid #e5e5e5; padding: 15px; border-radius: 6px; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="reminder">
              <h2>📅 Upcoming Post</h2>
              <p><strong>Campaign:</strong> ${data.campaignName}</p>
              <p><strong>Platform:</strong> ${data.platform}</p>
              <p><strong>Scheduled:</strong> ${data.scheduledTime}</p>
            </div>
            <div class="preview">
              <p><strong>Preview:</strong></p>
              <p>${data.content}</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Post scheduled for ${data.scheduledTime} on ${data.platform}`
  })
};

// Send email function
export async function sendEmail(
  to: string,
  template: keyof typeof emailTemplates,
  data: any
) {
  try {
    const emailContent = emailTemplates[template](data);
    
    const result = await resend.emails.send({
      from: 'CheersAI <notifications@cheersai.orangejelly.co.uk>',
      to,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    return { success: true, data: result };
  } catch (error) {
    console.error('Failed to send email:', error);
    return { success: false, error };
  }
}

// Batch send emails
export async function sendBatchEmails(
  recipients: Array<{ to: string; template: keyof typeof emailTemplates; data: any }>
) {
  const results = await Promise.allSettled(
    recipients.map(({ to, template, data }) => sendEmail(to, template, data))
  );
  
  return results.map((result, index) => ({
    recipient: recipients[index].to,
    ...result
  }));
}
