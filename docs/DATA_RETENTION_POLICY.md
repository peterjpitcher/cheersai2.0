# Data Retention Policy - UK GDPR Compliance

## Overview

Note: Product Analytics is not currently offered. Any references to "Analytics Data" in this document reflect a potential future state and are not collected at this time.

CheersAI implements comprehensive data retention policies compliant with UK GDPR and the Data Protection Act 2018. This document outlines our data retention periods, deletion procedures, and user rights.

## UK ICO Guidelines Implementation

Our retention policies are based on UK ICO (Information Commissioner's Office) guidelines and represent standard practice for UK businesses:

### Data Categories and Retention Periods

| Data Type | Retention Period | Justification | UK ICO Compliant |
|-----------|------------------|---------------|------------------|
| **User Account Data** | 30 days after deletion request | UK ICO standard for account closure | ✅ Yes |
| **Analytics Data** | N/A (not collected) | Analytics feature not offered | ❌ No |
| **Generated Content** | While account active | Business operational requirement | ✅ Yes |
| **Media Files** | 90 days after last use | Storage optimization and user convenience | ✅ Yes |
| **Publishing History** | 1 year | Audit trail and compliance requirements | ✅ Yes |
| **Error Logs** | 90 days | Technical debugging and system monitoring | ✅ Yes |
| **Social Media Tokens** | Deleted immediately with account | Security and privacy requirement | ✅ Yes |

## Technical Implementation

### Database Schema Changes

The following `deleted_at` columns have been added to support soft deletion:

```sql
-- Core tables with soft delete support
ALTER TABLE tenants ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE brand_profiles ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE campaign_posts ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE media_assets ADD COLUMN deleted_at TIMESTAMPTZ, ADD COLUMN last_used_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE social_connections ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE publishing_history ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE publishing_queue ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE performance_metrics ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE error_logs ADD COLUMN deleted_at TIMESTAMPTZ;
```

### Automated Cleanup Process

A cron job runs daily to clean up expired data:

1. **Immediate Actions (Account Deletion)**:
   - Soft delete all user data
   - Mark account for 30-day retention period
   - Revoke social media access tokens

2. **Daily Cleanup (Automated)**:
   - Permanently delete data past retention periods
   - Clean up unused media files
   - Remove expired data exports
   - Archive old analytics data (not currently applicable)

### API Endpoints

- `POST /api/gdpr/cleanup` - Automated data cleanup (cron only)
- `POST /api/gdpr/delete-account` - User account deletion request
- `POST /api/gdpr/export-data` - User data export

## User Rights Under UK GDPR

### 1. Right of Access
- Users can export all their data via the settings page
- Export includes: account data, campaigns, posts, media metadata, publishing history
- Provided in machine-readable JSON format

### 2. Right to Rectification
- Users can update account details through settings
- Brand profile and preferences are editable
- Social connections can be updated/removed

### 3. Right to Erasure ("Right to be Forgotten")
- Account deletion available through settings UI
- 30-day grace period as per UK ICO guidelines
- Permanent deletion after retention period

### 4. Right to Data Portability
- Full data export in JSON format
- Includes all personal data and user-generated content
- Compatible with industry standards

### 5. Right to Restrict Processing
- Users can deactivate their accounts without deletion
- Processing stops while maintaining data integrity
- Available through support contact

### 6. Right to Object
- Users can object to specific data processing
- Marketing preferences are user-controlled
- Analytics participation can be limited

## Data Protection Officer Contact

For any data protection queries or to exercise your rights:

**Email**: privacy@orangejelly.co.uk  
**Response Time**: Within 30 days as per UK GDPR requirements

## Compliance Monitoring

### Regular Audits
- Monthly review of retention policy effectiveness
- Quarterly audit of automated cleanup processes
- Annual review of UK ICO guideline changes

### Documentation
- All data deletion activities are logged
- User requests tracked with timestamps
- Compliance reports generated monthly

## Security Measures

### During Retention Period
- Data encrypted at rest and in transit
- Access controlled through RLS policies
- Regular security audits and monitoring

### During Deletion Process
- Secure deletion methods used
- Backups cleared according to schedule
- Verification of complete data removal

## Implementation Timeline

1. **Phase 1**: Database migration with soft delete columns ✅
2. **Phase 2**: API endpoints for data export and deletion ✅  
3. **Phase 3**: User interface for data management ✅
4. **Phase 4**: Automated cleanup cron job ✅
5. **Phase 5**: Documentation and compliance monitoring ✅

## Legal Basis

Our data retention policy is based on:

- **UK GDPR (General Data Protection Regulation)**
- **Data Protection Act 2018**
- **UK ICO Guidelines on Data Retention**
- **Industry Best Practices for SaaS Platforms**

## Updates and Changes

This policy will be reviewed annually and updated as necessary to maintain compliance with:
- Changes in UK data protection law
- Updates to UK ICO guidance
- Industry best practice evolution
- Business requirement changes

*Last Updated: August 21, 2025*  
*Next Review: August 21, 2026*

## Technical Contact

For technical implementation details:
- Review migration file: `supabase/migrations/20250821_add_gdpr_data_retention.sql`
- API documentation: See `/api/gdpr/*` endpoint implementations
- UI implementation: `/app/(authed)/settings/page.tsx` - Data & Privacy tab
