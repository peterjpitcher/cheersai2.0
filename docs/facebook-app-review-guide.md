# Facebook App Review Guide - Screencast Requirements
> Note: References to the in-app Analytics section in this guide are historical; the Analytics page is not part of the current product.

## Overview

This guide provides step-by-step instructions for creating screencasts required for Facebook App Review submission. Our application requires three specific permissions that must be demonstrated through professional screencasts.

## Required Permissions

Our CheersAI application requests the following permissions:

1. **pages_show_list** - Access list of Pages managed by a person
2. **pages_read_engagement** - Read engagement data for Pages
3. **pages_manage_posts** - Create, edit, and delete Page posts

## Production Environment Requirements

### Pre-Submission Checklist

- [ ] Application deployed to production environment
- [ ] HTTPS enabled with valid SSL certificate
- [ ] Privacy Policy published and accessible
- [ ] Terms of Service published and accessible
- [ ] Data Deletion Instructions available
- [ ] Facebook App ID configured for production domain
- [ ] All OAuth redirect URIs updated for production

### Production URLs Required

- **App URL**: https://yourdomain.com
- **Privacy Policy**: https://yourdomain.com/privacy
- **Terms of Service**: https://yourdomain.com/terms
- **Data Deletion**: https://yourdomain.com/data-deletion

## Screencast Recording Requirements

### Technical Specifications

- **Resolution**: Minimum 1280x720 (720p HD)
- **Frame Rate**: 30 FPS minimum
- **Duration**: 2-5 minutes per permission
- **Format**: MP4, MOV, or AVI
- **Audio**: Clear narration explaining each step
- **File Size**: Maximum 1GB per video

### Recommended Recording Tools

- **macOS**: QuickTime Player (built-in) or ScreenFlow
- **Windows**: OBS Studio (free) or Camtasia
- **Online**: Loom or Screencastify

## Screencast 1: pages_show_list Permission

### Purpose
Demonstrate how our application retrieves and displays the list of Facebook Pages that a user manages.

### Step-by-Step Recording

1. **Introduction (0:00-0:15)**
   - "This screencast demonstrates how CheersAI accesses the list of Facebook Pages managed by a user"
   - Show the CheersAI login page

2. **User Login (0:15-0:30)**
   - Log into CheersAI with a test account
   - Navigate to Settings > Connections

3. **Facebook Connection Initiation (0:30-1:00)**
   - Click "Connect Facebook" button
   - Show Facebook OAuth dialog appearing
   - Highlight the pages_show_list permission request

4. **Permission Grant (1:00-1:30)**
   - Accept the Facebook permissions
   - Show successful connection confirmation

5. **Page List Display (1:30-2:30)**
   - Navigate to the connected accounts section
   - Show the list of Facebook Pages retrieved
   - Demonstrate page selection functionality
   - Explain: "The application now displays all Pages this user manages, allowing them to select which Pages to use for content publishing"

6. **Use Case Explanation (2:30-3:00)**
   - "This permission allows business owners to see all their managed Pages and choose which ones to connect to CheersAI for social media management"

### Key Points to Highlight

- Clear explanation of why this permission is needed
- Show the actual Page list being retrieved and displayed
- Demonstrate legitimate business use case
- Show user control over Page selection

## Screencast 2: pages_read_engagement Permission

### Purpose
Demonstrate how our application reads engagement data (likes, comments, shares) from connected Facebook Pages.

### Step-by-Step Recording

1. **Introduction (0:00-0:15)**
   - "This screencast shows how CheersAI reads engagement data from connected Facebook Pages for analytics purposes"

2. **Navigate to Analytics (0:15-0:45)**
   - Start from CheersAI dashboard
   - Navigate to Analytics section
   - Show connected Facebook Pages

3. **Permission Usage Display (0:45-2:00)**
   - Display engagement metrics dashboard
   - Show specific metrics being retrieved:
     - Post likes count
     - Comments count
     - Shares count
     - Reach and impressions
   - Demonstrate date range filtering

4. **Detailed Engagement View (2:00-2:45)**
   - Click on individual posts to show detailed engagement
   - Display comment threads (without personal data)
   - Show engagement trends over time

5. **Business Value Explanation (2:45-3:15)**
   - "This engagement data helps businesses understand their audience and optimize their social media strategy"
   - Show how metrics inform content decisions

### Key Points to Highlight

- Legitimate business analytics use case
- Data is used for business insights, not personal profiling
- Helps businesses improve their social media performance
- User maintains control over which Pages to analyze

## Screencast 3: pages_manage_posts Permission

### Purpose
Demonstrate how our application creates, edits, and schedules posts to Facebook Pages.

### Step-by-Step Recording

1. **Introduction (0:00-0:15)**
   - "This screencast demonstrates CheersAI's core functionality: managing posts on connected Facebook Pages"

2. **Campaign Creation (0:15-1:00)**
   - Navigate to Campaigns section
   - Create a new campaign
   - Show AI content generation for Facebook post
   - Select target Facebook Page

3. **Post Creation and Editing (1:00-2:00)**
   - Show post preview for Facebook
   - Demonstrate editing capabilities:
     - Text editing
     - Image attachment
     - Hashtag optimization
   - Show platform-specific formatting

4. **Scheduling Functionality (2:00-2:30)**
   - Set publication schedule
   - Show publishing queue
   - Demonstrate immediate and scheduled posting options

5. **Post Publication (2:30-3:30)**
   - Publish a post to the connected Facebook Page
   - Show successful publication confirmation
   - Navigate to Facebook Page to verify post was created
   - Show the published post on the actual Facebook Page

6. **Post Management (3:30-4:00)**
   - Demonstrate post editing after publication
   - Show post deletion functionality
   - Explain: "Users maintain full control over their published content"

### Key Points to Highlight

- Core business functionality for social media management
- User maintains full control over content
- Legitimate business use case for hospitality industry
- Professional content creation and scheduling

## Recording Best Practices

### Audio Narration Tips

- **Clear Speech**: Speak slowly and clearly
- **Explain Actions**: Narrate every action as you perform it
- **Business Context**: Always relate actions to legitimate business needs
- **Professional Tone**: Maintain a professional, educational tone

### Visual Best Practices

- **Clean Interface**: Use a clean, professional test environment
- **Highlight Actions**: Use mouse highlighting or cursor effects
- **Smooth Navigation**: Move slowly between screens
- **Clear Annotations**: Add text overlays for important information

### Content Guidelines

- **No Personal Data**: Never show real customer data or personal information
- **Test Accounts**: Use clearly marked test accounts and demo data
- **Business Context**: Always frame functionality in terms of legitimate business needs
- **User Control**: Emphasize user control and data privacy

## Pre-Recording Preparation

### Environment Setup

1. **Clean Browser**: Use incognito/private browsing mode
2. **Test Data**: Prepare clean test data and demo content
3. **Stable Connection**: Ensure stable internet connection
4. **Facebook Test Page**: Create a dedicated Facebook Page for demonstration
5. **Script Preparation**: Write a script for consistent narration

### Test Account Requirements

- Create dedicated Facebook test accounts
- Set up test Facebook Pages with sample content
- Ensure test accounts have appropriate permissions
- Prepare sample posts and engagement data

## Common Rejection Reasons and How to Avoid Them

### Insufficient Demonstration

- **Problem**: Not clearly showing how permissions are used
- **Solution**: Show the complete user journey from permission request to actual usage

### Poor Audio Quality

- **Problem**: Unclear narration or background noise
- **Solution**: Use a good microphone and quiet recording environment

### Lack of Business Context

- **Problem**: Not explaining why permissions are needed
- **Solution**: Always relate functionality to legitimate business needs

### Technical Issues

- **Problem**: App crashes or errors during recording
- **Solution**: Thoroughly test the flow before recording

### Privacy Violations

- **Problem**: Showing personal user data
- **Solution**: Use test accounts and demo data only

## Submission Process

### File Organization

Create a folder structure for submission:
```
facebook-app-review-submission/
├── screencast-1-pages-show-list.mp4
├── screencast-2-pages-read-engagement.mp4
├── screencast-3-pages-manage-posts.mp4
├── app-description.txt
└── use-case-explanations.txt
```

### Upload Requirements

- Upload videos to Facebook's App Review interface
- Provide clear titles for each screencast
- Include detailed descriptions of each permission use case
- Submit all three screencasts together

### Follow-up Actions

- Monitor App Review status regularly
- Respond promptly to any Facebook requests for clarification
- Be prepared to provide additional documentation if requested

## Troubleshooting Common Issues

### OAuth Flow Problems

- Ensure redirect URIs match exactly
- Verify Facebook App configuration
- Check production domain SSL certificate

### Permission Display Issues

- Clear browser cache before recording
- Test OAuth flow multiple times
- Verify all permissions are properly requested

### Video Quality Issues

- Test recording software before final recording
- Ensure adequate screen resolution
- Check audio levels throughout recording

## Post-Approval Considerations

### Compliance Monitoring

- Regularly review Facebook API usage policies
- Monitor for any policy changes
- Maintain audit logs of API usage

### Permission Usage Tracking

- Implement analytics to track permission usage
- Document legitimate business use cases
- Prepare for periodic Facebook reviews

## Contact Information

For questions about this guide or Facebook App Review process:

- **Development Team**: dev@cheersai.com
- **Compliance Officer**: compliance@cheersai.com
- **Facebook Developer Support**: https://developers.facebook.com/support/

---

**Note**: This guide should be updated whenever Facebook changes their App Review requirements or when our application's functionality changes significantly.
