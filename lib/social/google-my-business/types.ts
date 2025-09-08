export interface GoogleMyBusinessPost {
  summary: string;
  media?: {
    mediaFormat: 'PHOTO' | 'VIDEO';
    sourceUrl: string;
  }[];
  callToAction?: {
    actionType: 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'GET_OFFER' | 'CALL';
    url?: string;
    phone?: string;
  };
  event?: {
    title: string;
    schedule: {
      startDate: string;
      startTime?: string;
      endDate?: string;
      endTime?: string;
    };
  };
  offer?: {
    couponCode?: string;
    redeemOnlineUrl?: string;
    termsConditions?: string;
  };
  topicType?: 'STANDARD' | 'EVENT' | 'OFFER' | 'ALERT';
}

export interface GoogleMyBusinessLocation {
  name: string;
  locationId: string;
  title: string;
  address: {
    addressLines: string[];
    locality: string;
    administrativeArea: string;
    postalCode: string;
    country: string;
  };
}

export interface GoogleMyBusinessAccount {
  name: string;
  accountId: string;
  type: 'PERSONAL' | 'LOCATION_GROUP' | 'USER_GROUP' | 'ORGANIZATION';
  verificationState: 'VERIFIED' | 'UNVERIFIED' | 'VERIFICATION_REQUESTED';
  locations?: GoogleMyBusinessLocation[];
}

export interface GoogleMyBusinessConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string;
  accessToken?: string;
  tenantId?: string; // for safer DB updates
  connectionId?: string; // specific social_connection id for DB updates
}

export interface GoogleMyBusinessResponse {
  success: boolean;
  postId?: string;
  name?: string;
  state?: 'REJECTED' | 'LIVE' | 'PENDING_DELETE';
  searchUrl?: string;
  error?: string;
  details?: any;
}

export interface GoogleMyBusinessMetrics {
  metricRequests: Array<{
    metric: 
      | 'ALL'
      | 'QUERIES_DIRECT'
      | 'QUERIES_INDIRECT' 
      | 'QUERIES_CHAIN'
      | 'VIEWS_MAPS'
      | 'VIEWS_SEARCH'
      | 'ACTIONS_WEBSITE'
      | 'ACTIONS_PHONE'
      | 'ACTIONS_DRIVING_DIRECTIONS'
      | 'PHOTOS_VIEWS_MERCHANT'
      | 'PHOTOS_VIEWS_CUSTOMERS'
      | 'PHOTOS_COUNT_MERCHANT'
      | 'PHOTOS_COUNT_CUSTOMERS'
      | 'LOCAL_POST_VIEWS_SEARCH'
      | 'LOCAL_POST_ACTIONS_CALL_TO_ACTION';
    options?: 'AGGREGATED_TOTAL' | 'AGGREGATED_DAILY' | 'BREAKDOWN_HOUR_OF_DAY' | 'BREAKDOWN_DAY_OF_WEEK';
  }>;
  timeRange: {
    startTime: string;
    endTime: string;
  };
}

export interface GoogleMyBusinessInsights {
  locationMetrics?: Array<{
    locationName: string;
    timeZone: string;
    metricValues: Array<{
      metric: string;
      totalValue?: {
        metricOption?: string;
        timeDimension?: {
          timeRange: {
            startTime: string;
            endTime: string;
          };
          dayOfWeek?: string;
          timeOfDay?: {
            hours: number;
            minutes: number;
            seconds: number;
            nanos: number;
          };
        };
        value?: string;
      };
      dimensionalValues?: Array<{
        metricOption?: string;
        timeDimension?: any;
        value?: string;
      }>;
    }>;
  }>;
}

export interface GoogleMyBusinessReview {
  reviewId: string;
  reviewer: {
    profilePhotoUrl?: string;
    displayName?: string;
    isAnonymous?: boolean;
  };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}
