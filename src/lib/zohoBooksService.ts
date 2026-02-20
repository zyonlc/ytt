import { supabase } from './supabase';

// Zoho Books API configuration
const ZOHO_BOOKS_API_BASE = 'https://www.zohoapis.com/books/v3';
const ZOHO_OAUTH_AUTH_URL = 'https://accounts.zoho.com/oauth/v2/auth';
const ZOHO_OAUTH_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';

// Client ID and Secret should be in environment variables
const ZOHO_CLIENT_ID = import.meta.env.VITE_ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = import.meta.env.VITE_ZOHO_CLIENT_SECRET;

// Get the correct redirect URI - use environment variable if available, otherwise construct it
// In Builder environments, window.location.origin may be incorrect, so we explicitly set it
const getRedirectURI = () => {
  // If set as environment variable, use that (most reliable)
  if (import.meta.env.VITE_ZOHO_REDIRECT_URI) {
    return import.meta.env.VITE_ZOHO_REDIRECT_URI;
  }
  // Otherwise construct from current origin
  return `${window.location.origin}/books/callback`;
};

const ZOHO_REDIRECT_URI = getRedirectURI();

// Debug: Log environment variable status
if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
  console.error('🔴 Zoho Books environment variables not set!');
  console.error('VITE_ZOHO_CLIENT_ID:', ZOHO_CLIENT_ID ? 'SET' : 'MISSING');
  console.error('VITE_ZOHO_CLIENT_SECRET:', ZOHO_CLIENT_SECRET ? 'SET' : 'MISSING');
} else {
  console.log('✅ Zoho Books credentials loaded');
}

// ============================================================================
// OAUTH AUTHENTICATION
// ============================================================================

/**
 * Get OAuth authorization URL for Zoho Books
 */
export const getZohoBooksAuthUrl = (): string => {
  if (!ZOHO_CLIENT_ID) {
    throw new Error('Zoho Books Client ID not configured. Check VITE_ZOHO_CLIENT_ID environment variable.');
  }

  console.log('🔵 Generating OAuth URL with:', {
    clientId: ZOHO_CLIENT_ID,
    redirectUri: ZOHO_REDIRECT_URI,
  });

  const params = new URLSearchParams({
    client_id: ZOHO_CLIENT_ID,
    redirect_uri: ZOHO_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    scope: 'ZohoBooks.fullaccess.ALL',
    state: generateState(),
  });

  const authUrl = `${ZOHO_OAUTH_AUTH_URL}?${params.toString()}`;
  console.log('🔵 OAuth URL:', authUrl);

  return authUrl;
};

/**
 * Generate random state for OAuth security
 */
function generateState(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * DEPRECATED: Token exchange now handled by Supabase Edge Function
 * This function is kept for backward compatibility but should not be used
 */
export const exchangeCodeForToken = async (code: string, userId: string) => {
  console.warn('⚠️ exchangeCodeForToken is deprecated. Use Supabase Edge Function instead.');
  throw new Error('Use Supabase Edge Function zoho-oauth-exchange instead');
};

/**
 * Refresh access token if expired
 */
export const refreshZohoBooksToken = async (userId: string) => {
  try {
    const { data: integration, error: fetchError } = await supabase
      .from('zoho_books_integrations')
      .select('refresh_token, token_expires_at')
      .eq('user_id', userId)
      .single();

    if (fetchError || !integration?.refresh_token) {
      throw new Error('No refresh token found');
    }

    const response = await fetch(ZOHO_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ZOHO_CLIENT_ID,
        client_secret: ZOHO_CLIENT_SECRET,
        refresh_token: integration.refresh_token,
      }).toString(),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Token refresh failed: ${data.error}`);
    }

    // Update tokens
    const { error: updateError } = await supabase
      .from('zoho_books_integrations')
      .update({
        access_token: data.access_token,
        token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    return data.access_token;
  } catch (error) {
    console.error('Error refreshing Zoho Books token:', error);
    throw error;
  }
};

// ============================================================================
// API HELPERS
// ============================================================================

/**
 * Get valid access token, refreshing if necessary
 */
export const getValidAccessToken = async (userId: string): Promise<string> => {
  const { data: integration, error: fetchError } = await supabase
    .from('zoho_books_integrations')
    .select('access_token, token_expires_at')
    .eq('user_id', userId)
    .single();

  if (fetchError || !integration?.access_token) {
    throw new Error('No Zoho Books integration found');
  }

  const expiresAt = new Date(integration.token_expires_at);
  if (expiresAt < new Date()) {
    return refreshZohoBooksToken(userId);
  }

  return integration.access_token;
};

/**
 * Make authenticated request to Zoho Books API
 */
export const zohoBooksApiCall = async (
  userId: string,
  organizationId: string,
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any
) => {
  const accessToken = await getValidAccessToken(userId);

  const url = new URL(`${ZOHO_BOOKS_API_BASE}${endpoint}`);
  url.searchParams.set('organization_id', organizationId);

  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Zoho Books API error: ${error.message || response.statusText}`);
  }

  return response.json();
};

/**
 * Get user's organization ID and cache it
 */
export const getOrganizationId = async (userId: string): Promise<string> => {
  const { data: integration, error } = await supabase
    .from('zoho_books_integrations')
    .select('organization_id')
    .eq('user_id', userId)
    .single();

  if (error) throw error;

  if (integration?.organization_id) {
    return integration.organization_id;
  }

  // Fetch from API if not cached
  const accessToken = await getValidAccessToken(userId);
  const response = await fetch(`${ZOHO_BOOKS_API_BASE}/organizations`, {
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
    },
  });

  const data = await response.json();
  const orgId = data.organizations?.[0]?.organization_id;

  if (!orgId) throw new Error('No organization found');

  // Cache it
  await supabase
    .from('zoho_books_integrations')
    .update({ organization_id: orgId })
    .eq('user_id', userId);

  return orgId;
};

// ============================================================================
// INVOICES API
// ============================================================================

export const getInvoices = async (
  userId: string,
  organizationId: string,
  filters?: {
    status?: 'draft' | 'sent' | 'viewed' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
    limit?: number;
    offset?: number;
  }
) => {
  const endpoint = '/invoices';
  const params = new URLSearchParams();
  
  if (filters?.status) {
    params.set('status', filters.status);
  }
  if (filters?.limit) {
    params.set('limit', filters.limit.toString());
  }
  if (filters?.offset) {
    params.set('offset', filters.offset.toString());
  }

  return zohoBooksApiCall(
    userId,
    organizationId,
    `${endpoint}${params.toString() ? '?' + params.toString() : ''}`,
    'GET'
  );
};

export const getInvoice = async (userId: string, organizationId: string, invoiceId: string) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    `/invoices/${invoiceId}`,
    'GET'
  );
};

export const createInvoice = async (
  userId: string,
  organizationId: string,
  invoiceData: {
    customer_id: string;
    invoice_number?: string;
    reference_number?: string;
    invoice_date?: string;
    due_date?: string;
    due_days?: number;
    line_items: Array<{
      item_id: string;
      quantity?: number;
      rate?: number;
      description?: string;
    }>;
    notes?: string;
    terms?: string;
    is_emailed?: boolean;
  }
) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    '/invoices',
    'POST',
    invoiceData
  );
};

export const updateInvoice = async (
  userId: string,
  organizationId: string,
  invoiceId: string,
  invoiceData: any
) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    `/invoices/${invoiceId}`,
    'PUT',
    invoiceData
  );
};

export const deleteInvoice = async (userId: string, organizationId: string, invoiceId: string) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    `/invoices/${invoiceId}`,
    'DELETE'
  );
};

// ============================================================================
// CUSTOMERS API
// ============================================================================

export const getCustomers = async (
  userId: string,
  organizationId: string,
  filters?: {
    limit?: number;
    offset?: number;
    status?: 'active' | 'inactive';
  }
) => {
  const endpoint = '/contacts';
  const params = new URLSearchParams();
  
  if (filters?.limit) {
    params.set('limit', filters.limit.toString());
  }
  if (filters?.offset) {
    params.set('offset', filters.offset.toString());
  }
  if (filters?.status) {
    params.set('status', filters.status);
  }

  return zohoBooksApiCall(
    userId,
    organizationId,
    `${endpoint}${params.toString() ? '?' + params.toString() : ''}`,
    'GET'
  );
};

export const getCustomer = async (userId: string, organizationId: string, customerId: string) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    `/contacts/${customerId}`,
    'GET'
  );
};

export const createCustomer = async (
  userId: string,
  organizationId: string,
  customerData: {
    contact_name: string;
    company_name?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    fax?: string;
    website?: string;
    billing_address?: {
      address?: string;
      street2?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    };
    shipping_address?: {
      address?: string;
      street2?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    };
    notes?: string;
  }
) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    '/contacts',
    'POST',
    customerData
  );
};

export const updateCustomer = async (
  userId: string,
  organizationId: string,
  customerId: string,
  customerData: any
) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    `/contacts/${customerId}`,
    'PUT',
    customerData
  );
};

// ============================================================================
// EXPENSES API
// ============================================================================

export const getExpenses = async (
  userId: string,
  organizationId: string,
  filters?: {
    limit?: number;
    offset?: number;
    status?: 'draft' | 'submitted' | 'approved' | 'paid' | 'reimbursed';
  }
) => {
  const endpoint = '/expenses';
  const params = new URLSearchParams();
  
  if (filters?.limit) {
    params.set('limit', filters.limit.toString());
  }
  if (filters?.offset) {
    params.set('offset', filters.offset.toString());
  }
  if (filters?.status) {
    params.set('status', filters.status);
  }

  return zohoBooksApiCall(
    userId,
    organizationId,
    `${endpoint}${params.toString() ? '?' + params.toString() : ''}`,
    'GET'
  );
};

export const createExpense = async (
  userId: string,
  organizationId: string,
  expenseData: {
    account_id: string;
    vendor_id?: string;
    vendor_name?: string;
    reference_number?: string;
    expense_date: string;
    total: number;
    notes?: string;
    attachments?: Array<{
      file_name: string;
      file_type: string;
      file_content: string; // base64 encoded
    }>;
  }
) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    '/expenses',
    'POST',
    expenseData
  );
};

// ============================================================================
// REPORTS API
// ============================================================================

export const getProfitAndLoss = async (userId: string, organizationId: string) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    '/reports/profitandloss',
    'GET'
  );
};

export const getBalance = async (userId: string, organizationId: string) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    '/reports/balancesheet',
    'GET'
  );
};

export const getCashFlow = async (userId: string, organizationId: string) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    '/reports/cashflow',
    'GET'
  );
};

export const getExpenseReport = async (userId: string, organizationId: string) => {
  return zohoBooksApiCall(
    userId,
    organizationId,
    '/reports/expenses',
    'GET'
  );
};

// ============================================================================
// DISCONNECT
// ============================================================================

export const disconnectZohoBooks = async (userId: string) => {
  const { error } = await supabase
    .from('zoho_books_integrations')
    .update({
      is_connected: false,
      access_token: null,
      refresh_token: null,
      disconnected_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) throw error;
  return { success: true };
};

// ============================================================================
// CONNECTION STATUS
// ============================================================================

export const getZohoBooksStatus = async (userId: string) => {
  const { data, error } = await supabase
    .from('zoho_books_integrations')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    return {
      is_connected: false,
      organization_id: null,
      connected_at: null,
    };
  }

  return {
    is_connected: data?.is_connected || false,
    organization_id: data?.organization_id,
    connected_at: data?.connected_at,
    disconnected_at: data?.disconnected_at,
  };
};
