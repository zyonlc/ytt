import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  FileText,
  Users,
  TrendingUp,
  BarChart3,
  Plus,
  LogOut,
  Eye,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  DollarSign,
  Mail,
  Zap,
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import {
  getZohoBooksAuthUrl,
  getZohoBooksStatus,
  getInvoices,
  getCustomers,
  getExpenses,
  getProfitAndLoss,
  getOrganizationId,
  disconnectZohoBooks,
  createInvoice,
  createCustomer,
  createExpense,
} from '../lib/zohoBooksService';
import { supabase } from '../lib/supabase';

interface Invoice {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  total: number;
  status: string;
  invoice_date: string;
  due_date: string;
}

interface Customer {
  contact_id: string;
  contact_name: string;
  email: string;
  company_name?: string;
  phone?: string;
}

interface Expense {
  expense_id: string;
  vendor_name: string;
  amount: number;
  status: string;
  expense_date: string;
}

interface TabType {
  tab: 'dashboard' | 'invoices' | 'customers' | 'expenses' | 'reports';
}

export default function Books() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'invoices' | 'customers' | 'expenses' | 'reports'>('dashboard');
  const [isProcessingCallback, setIsProcessingCallback] = useState(false);

  // Data states
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reports, setReports] = useState<any>(null);

  // Loading states
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);

  // Modal states
  const [showNewInvoiceModal, setShowNewInvoiceModal] = useState(false);
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [showNewExpenseModal, setShowNewExpenseModal] = useState(false);

  // Form states for invoices
  const [invoiceForm, setInvoiceForm] = useState({
    customer_id: '',
    description: '',
    quantity: 1,
    rate: 0,
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: '',
  });
  const [savingInvoice, setSavingInvoice] = useState(false);

  // Form states for customers
  const [customerForm, setCustomerForm] = useState({
    contact_name: '',
    email: '',
    phone: '',
    company_name: '',
  });
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Form states for expenses
  const [expenseForm, setExpenseForm] = useState({
    vendor_name: '',
    amount: 0,
    expense_date: new Date().toISOString().split('T')[0],
    account_id: '1', // Default expense account
    notes: '',
  });
  const [savingExpense, setSavingExpense] = useState(false);

  // Handle OAuth callback from Zoho Books
  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        // Parse URL parameters
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const errorParam = url.searchParams.get('error');

        // If no OAuth params, this is a normal page load
        if (!code && !errorParam) {
          return;
        }

        // Log callback trigger
        console.log('🔵 OAuth callback detected on Books page', { code: !!code, error: errorParam, userAuthenticated: !!user?.id });

        // Handle error from Zoho
        if (errorParam) {
          addToast(`Authorization failed: ${errorParam}`, 'error');
          // Clean up URL
          window.history.replaceState({}, document.title, '/books');
          return;
        }

        // Require authentication
        if (!user?.id) {
          console.warn('⚠️ User not authenticated yet, waiting...');
          return;
        }

        if (!code) {
          console.warn('⚠️ No authorization code received');
          return;
        }

        setIsProcessingCallback(true);

        // Call Supabase Edge Function to exchange code for token
        const redirectUri = import.meta.env.VITE_ZOHO_REDIRECT_URI || `${window.location.origin}/books`;

        console.log('🔵 Exchanging OAuth code via Edge Function');

        const { data, error: functionError } = await supabase.functions.invoke('zoho-oauth-exchange', {
          body: {
            code,
            redirectUri,
            userId: user.id,
          },
        });

        if (functionError) {
          console.error('🔴 Edge Function error:', functionError);
          addToast('Failed to connect Zoho Books', 'error');
          window.history.replaceState({}, document.title, '/books');
          return;
        }

        if (!data?.success) {
          console.error('🔴 Token exchange failed:', data?.error);
          addToast(`Connection failed: ${data?.error || 'Unknown error'}`, 'error');
          window.history.replaceState({}, document.title, '/books');
          return;
        }

        console.log('✅ OAuth callback processed successfully');
        addToast('Zoho Books connected successfully!', 'success');

        // Clean up URL
        window.history.replaceState({}, document.title, '/books');

        // Refresh page to show connected state
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } catch (error) {
        console.error('🔴 OAuth callback error:', error);
        addToast(error instanceof Error ? error.message : 'Connection failed', 'error');
        window.history.replaceState({}, document.title, '/books');
      } finally {
        setIsProcessingCallback(false);
      }
    };

    handleOAuthCallback();
  }, [user?.id, addToast]);

  // Check Zoho Books connection status
  useEffect(() => {
    if (!user?.id || isProcessingCallback) return;

    const checkStatus = async () => {
      try {
        const status = await getZohoBooksStatus(user.id);
        setIsConnected(status.is_connected);
        if (status.is_connected && status.organization_id) {
          setOrganizationId(status.organization_id);
        }
      } catch (error) {
        console.error('Error checking Zoho Books status:', error);
      } finally {
        setLoading(false);
      }
    };

    checkStatus();
  }, [user, isProcessingCallback]);

  // Load data when connected
  useEffect(() => {
    if (!isConnected || !user?.id || !organizationId) return;

    if (activeTab === 'invoices') {
      loadInvoicesData();
    } else if (activeTab === 'customers') {
      loadCustomersData();
    } else if (activeTab === 'expenses') {
      loadExpensesData();
    } else if (activeTab === 'dashboard') {
      loadDashboardData();
    } else if (activeTab === 'reports') {
      loadReportsData();
    }
  }, [activeTab, isConnected, organizationId, user?.id]);

  // Load invoices
  const loadInvoicesData = async () => {
    if (!user?.id || !organizationId) return;
    setLoadingInvoices(true);
    try {
      const data = await getInvoices(user.id, organizationId);
      setInvoices(data.invoices || []);
    } catch (error) {
      console.error('Error loading invoices:', error);
      addToast('Failed to load invoices', 'error');
    } finally {
      setLoadingInvoices(false);
    }
  };

  // Load customers
  const loadCustomersData = async () => {
    if (!user?.id || !organizationId) return;
    setLoadingCustomers(true);
    try {
      const data = await getCustomers(user.id, organizationId);
      setCustomers(data.contacts || []);
    } catch (error) {
      console.error('Error loading customers:', error);
      addToast('Failed to load customers', 'error');
    } finally {
      setLoadingCustomers(false);
    }
  };

  // Load expenses
  const loadExpensesData = async () => {
    if (!user?.id || !organizationId) return;
    setLoadingExpenses(true);
    try {
      const data = await getExpenses(user.id, organizationId);
      setExpenses(data.expenses || []);
    } catch (error) {
      console.error('Error loading expenses:', error);
      addToast('Failed to load expenses', 'error');
    } finally {
      setLoadingExpenses(false);
    }
  };

  // Load reports
  const loadReportsData = async () => {
    if (!user?.id || !organizationId) return;
    setLoadingReports(true);
    try {
      const data = await getProfitAndLoss(user.id, organizationId);
      setReports(data);
    } catch (error) {
      console.error('Error loading reports:', error);
      addToast('Failed to load reports', 'error');
    } finally {
      setLoadingReports(false);
    }
  };

  // Load dashboard summary
  const loadDashboardData = async () => {
    if (!user?.id || !organizationId) return;
    try {
      const [invoicesData, customersData, expensesData] = await Promise.all([
        getInvoices(user.id, organizationId, { limit: 5 }),
        getCustomers(user.id, organizationId, { limit: 5 }),
        getExpenses(user.id, organizationId, { limit: 5 }),
      ]);
      setInvoices(invoicesData.invoices || []);
      setCustomers(customersData.contacts || []);
      setExpenses(expensesData.expenses || []);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    }
  };

  // Get OAuth URL for the connect link
  const getConnectUrl = () => {
    try {
      return getZohoBooksAuthUrl();
    } catch (error) {
      console.error('🔴 Error generating OAuth URL:', error);
      addToast(error instanceof Error ? error.message : 'Failed to generate OAuth URL', 'error');
      return '#';
    }
  };

  // Handle disconnect
  const handleDisconnect = async () => {
    if (!user?.id || !window.confirm('Are you sure you want to disconnect Zoho Books?')) return;

    try {
      await disconnectZohoBooks(user.id);
      setIsConnected(false);
      setOrganizationId(null);
      addToast('Zoho Books disconnected', 'success');
    } catch (error) {
      console.error('Error disconnecting:', error);
      addToast('Failed to disconnect', 'error');
    }
  };

  // Handle create invoice
  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !organizationId) {
      addToast('User or organization not found', 'error');
      return;
    }

    if (!invoiceForm.customer_id) {
      addToast('Please select a customer', 'error');
      return;
    }

    if (!invoiceForm.description) {
      addToast('Please enter an item description', 'error');
      return;
    }

    if (invoiceForm.quantity <= 0) {
      addToast('Quantity must be greater than 0', 'error');
      return;
    }

    if (invoiceForm.rate <= 0) {
      addToast('Rate must be greater than 0', 'error');
      return;
    }

    setSavingInvoice(true);
    try {
      console.log('Creating invoice with data:', {
        customer_id: invoiceForm.customer_id,
        invoice_date: invoiceForm.invoice_date,
        due_date: invoiceForm.due_date,
        notes: invoiceForm.notes,
        line_items: [
          {
            item_id: '1',
            description: invoiceForm.description,
            quantity: invoiceForm.quantity,
            rate: invoiceForm.rate,
          },
        ],
      });

      const result = await createInvoice(user.id, organizationId, {
        customer_id: invoiceForm.customer_id,
        invoice_date: invoiceForm.invoice_date,
        due_date: invoiceForm.due_date,
        notes: invoiceForm.notes,
        line_items: [
          {
            item_id: '1',
            description: invoiceForm.description,
            quantity: invoiceForm.quantity,
            rate: invoiceForm.rate,
          },
        ],
      });

      console.log('Invoice creation result:', result);

      addToast('Invoice created successfully!', 'success');
      setShowNewInvoiceModal(false);
      setInvoiceForm({
        customer_id: '',
        description: '',
        quantity: 1,
        rate: 0,
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        notes: '',
      });
      await loadInvoicesData();
    } catch (error) {
      console.error('🔴 Error creating invoice:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create invoice';
      console.error('Error details:', { errorMsg, fullError: error });
      addToast(errorMsg, 'error');
    } finally {
      setSavingInvoice(false);
    }
  };

  // Handle create customer
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('🔵 handleCreateCustomer called!');

    if (!user?.id || !organizationId) {
      console.error('❌ User or organization missing:', { userId: user?.id, orgId: organizationId });
      addToast('User or organization not found', 'error');
      return;
    }

    if (!customerForm.contact_name) {
      console.error('❌ Customer name is empty');
      addToast('Customer name is required', 'error');
      return;
    }

    setSavingCustomer(true);
    console.log('📝 Calling createCustomer API with data:', {
      contact_name: customerForm.contact_name,
      email: customerForm.email || undefined,
      phone: customerForm.phone || undefined,
      company_name: customerForm.company_name || undefined,
    });

    try {
      console.log('Creating customer with data:', {
        contact_name: customerForm.contact_name,
        email: customerForm.email || undefined,
        phone: customerForm.phone || undefined,
        company_name: customerForm.company_name || undefined,
      });

      console.log('✅ About to call createCustomer...');

      const result = await createCustomer(user.id, organizationId, {
        contact_name: customerForm.contact_name,
        email: customerForm.email || undefined,
        phone: customerForm.phone || undefined,
        company_name: customerForm.company_name || undefined,
      });

      console.log('✅ Customer created! Result:', result);

      addToast('Customer created successfully!', 'success');
      setShowNewCustomerModal(false);
      setCustomerForm({
        contact_name: '',
        email: '',
        phone: '',
        company_name: '',
      });

      console.log('📚 Loading customers data...');
      await loadCustomersData();
      console.log('✅ Customers loaded!');

    } catch (error) {
      console.error('🔴 Error creating customer:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create customer';
      console.error('Error details:', {
        errorMsg,
        fullError: error,
        type: error instanceof Error ? error.constructor.name : typeof error
      });
      addToast(errorMsg, 'error');
    } finally {
      setSavingCustomer(false);
      console.log('🟡 Finally block - savingCustomer set to false');
    }
  };

  // Handle create expense
  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !organizationId) {
      addToast('User or organization not found', 'error');
      return;
    }

    if (!expenseForm.vendor_name) {
      addToast('Vendor name is required', 'error');
      return;
    }

    if (expenseForm.amount <= 0) {
      addToast('Amount must be greater than 0', 'error');
      return;
    }

    setSavingExpense(true);
    try {
      console.log('Creating expense with data:', {
        vendor_name: expenseForm.vendor_name,
        account_id: expenseForm.account_id,
        expense_date: expenseForm.expense_date,
        total: expenseForm.amount,
        notes: expenseForm.notes || undefined,
      });

      const result = await createExpense(user.id, organizationId, {
        vendor_name: expenseForm.vendor_name,
        account_id: expenseForm.account_id,
        expense_date: expenseForm.expense_date,
        total: expenseForm.amount,
        notes: expenseForm.notes || undefined,
      });

      console.log('Expense creation result:', result);

      addToast('Expense created successfully!', 'success');
      setShowNewExpenseModal(false);
      setExpenseForm({
        vendor_name: '',
        amount: 0,
        expense_date: new Date().toISOString().split('T')[0],
        account_id: '1',
        notes: '',
      });
      await loadExpensesData();
    } catch (error) {
      console.error('🔴 Error creating expense:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create expense';
      console.error('Error details:', { errorMsg, fullError: error });
      addToast(errorMsg, 'error');
    } finally {
      setSavingExpense(false);
    }
  };

  if (loading || isProcessingCallback) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 pt-20 px-4">
        <div className="max-w-7xl mx-auto flex items-center justify-center min-h-96">
          <div className="text-center">
            <div className="inline-block animate-spin">
              <Zap className="w-8 h-8 text-rose-400" />
            </div>
            <p className="mt-4 text-gray-300">
              {isProcessingCallback ? 'Connecting to Zoho Books...' : 'Loading Zoho Books...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 pt-20 px-4">
        <div className="max-w-2xl mx-auto mt-20">
          <div className="bg-gradient-to-br from-slate-800 to-slate-700 rounded-xl border border-white/10 p-12 text-center">
            <FileText className="w-16 h-16 text-rose-400 mx-auto mb-6" />
            <h2 className="text-3xl font-bold text-white mb-4">Connect Zoho Books</h2>
            <p className="text-gray-300 mb-8 text-lg">
              Integrate your Zoho Books account to manage invoices, customers, expenses, and financial reports directly from your dashboard.
            </p>

            <div className="bg-white/5 rounded-lg p-6 mb-8 text-left">
              <h3 className="font-semibold text-white mb-4">Features included:</h3>
              <ul className="space-y-2 text-gray-300">
                <li className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-rose-400" />
                  Invoice creation and management
                </li>
                <li className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-rose-400" />
                  Customer database management
                </li>
                <li className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-rose-400" />
                  Expense tracking and categorization
                </li>
                <li className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-rose-400" />
                  Financial reports and analytics
                </li>
              </ul>
            </div>

            <a
              href={getConnectUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-rose-500 to-purple-600 text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-rose-500/50 transition-all duration-300"
            >
              <Zap className="w-5 h-5" />
              Connect with Zoho Books
            </a>

            <p className="text-gray-400 text-sm mt-6">
              Secure OAuth connection. Your credentials are encrypted and never stored in plain text.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 pt-20">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Books</h1>
            <p className="text-gray-400">Manage your financial operations with Zoho Books</p>
          </div>
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors border border-red-500/30"
          >
            <LogOut className="w-4 h-4" />
            Disconnect
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {(['dashboard', 'invoices', 'customers', 'expenses', 'reports'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-rose-500 text-white'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm mb-2">Total Invoices</p>
                    <p className="text-3xl font-bold text-white">{invoices.length}</p>
                  </div>
                  <FileText className="w-8 h-8 text-blue-400" />
                </div>
              </div>

              <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 border border-emerald-500/30 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm mb-2">Customers</p>
                    <p className="text-3xl font-bold text-white">{customers.length}</p>
                  </div>
                  <Users className="w-8 h-8 text-emerald-400" />
                </div>
              </div>

              <div className="bg-gradient-to-br from-orange-500/20 to-orange-600/20 border border-orange-500/30 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm mb-2">Total Expenses</p>
                    <p className="text-3xl font-bold text-white">
                      ${expenses.reduce((sum, e) => sum + (e.amount || 0), 0).toFixed(2)}
                    </p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-orange-400" />
                </div>
              </div>

              <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-500/30 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm mb-2">Reports</p>
                    <p className="text-3xl font-bold text-white">Ready</p>
                  </div>
                  <BarChart3 className="w-8 h-8 text-purple-400" />
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Invoices */}
              <div className="bg-white/5 rounded-xl border border-white/10 p-6">
                <h3 className="text-xl font-bold text-white mb-4">Recent Invoices</h3>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {invoices.slice(0, 5).map((invoice) => (
                    <div key={invoice.invoice_id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                      <div>
                        <p className="text-white font-medium">{invoice.invoice_number}</p>
                        <p className="text-sm text-gray-400">{invoice.customer_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-white font-semibold">${invoice.total}</p>
                        <span className={`text-xs px-2 py-1 rounded ${
                          invoice.status === 'paid' ? 'bg-emerald-500/20 text-emerald-300' :
                          invoice.status === 'overdue' ? 'bg-red-500/20 text-red-300' :
                          'bg-yellow-500/20 text-yellow-300'
                        }`}>
                          {invoice.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Expenses */}
              <div className="bg-white/5 rounded-xl border border-white/10 p-6">
                <h3 className="text-xl font-bold text-white mb-4">Recent Expenses</h3>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {expenses.slice(0, 5).map((expense) => (
                    <div key={expense.expense_id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                      <div>
                        <p className="text-white font-medium">{expense.vendor_name}</p>
                        <p className="text-sm text-gray-400">{new Date(expense.expense_date).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-white font-semibold">${expense.amount}</p>
                        <span className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-300">
                          {expense.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Invoices Tab */}
        {activeTab === 'invoices' && (
          <div className="space-y-6">
            <button
              onClick={() => setShowNewInvoiceModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors font-semibold"
            >
              <Plus className="w-4 h-4" />
              New Invoice
            </button>

            {loadingInvoices ? (
              <div className="text-center py-12">
                <Zap className="w-8 h-8 text-rose-400 mx-auto mb-4 animate-spin" />
                <p className="text-gray-400">Loading invoices...</p>
              </div>
            ) : invoices.length === 0 ? (
              <div className="bg-white/5 rounded-lg border border-white/10 p-12 text-center">
                <FileText className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <p className="text-gray-400">No invoices found</p>
              </div>
            ) : (
              <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-white/10 border-b border-white/10">
                    <tr>
                      <th className="px-6 py-3 text-left text-white font-semibold">Invoice #</th>
                      <th className="px-6 py-3 text-left text-white font-semibold">Customer</th>
                      <th className="px-6 py-3 text-left text-white font-semibold">Amount</th>
                      <th className="px-6 py-3 text-left text-white font-semibold">Status</th>
                      <th className="px-6 py-3 text-left text-white font-semibold">Due Date</th>
                      <th className="px-6 py-3 text-left text-white font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {invoices.map((invoice) => (
                      <tr key={invoice.invoice_id} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-3 text-white">{invoice.invoice_number}</td>
                        <td className="px-6 py-3 text-gray-300">{invoice.customer_name}</td>
                        <td className="px-6 py-3 text-white font-semibold">${invoice.total}</td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                            invoice.status === 'paid' ? 'bg-emerald-500/20 text-emerald-300' :
                            invoice.status === 'overdue' ? 'bg-red-500/20 text-red-300' :
                            'bg-yellow-500/20 text-yellow-300'
                          }`}>
                            {invoice.status === 'paid' && <CheckCircle2 className="w-3 h-3" />}
                            {invoice.status === 'overdue' && <AlertCircle className="w-3 h-3" />}
                            {invoice.status === 'sent' && <Mail className="w-3 h-3" />}
                            {invoice.status !== 'paid' && invoice.status !== 'overdue' && invoice.status !== 'sent' && <Clock className="w-3 h-3" />}
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-gray-300">{new Date(invoice.due_date).toLocaleDateString()}</td>
                        <td className="px-6 py-3 flex gap-2">
                          <button className="p-2 hover:bg-white/10 rounded transition-colors">
                            <Eye className="w-4 h-4 text-gray-400" />
                          </button>
                          <button className="p-2 hover:bg-white/10 rounded transition-colors">
                            <Edit2 className="w-4 h-4 text-gray-400" />
                          </button>
                          <button className="p-2 hover:bg-white/10 rounded transition-colors">
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Customers Tab */}
        {activeTab === 'customers' && (
          <div className="space-y-6">
            <button
              onClick={() => setShowNewCustomerModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors font-semibold"
            >
              <Plus className="w-4 h-4" />
              New Customer
            </button>

            {loadingCustomers ? (
              <div className="text-center py-12">
                <Zap className="w-8 h-8 text-rose-400 mx-auto mb-4 animate-spin" />
                <p className="text-gray-400">Loading customers...</p>
              </div>
            ) : customers.length === 0 ? (
              <div className="bg-white/5 rounded-lg border border-white/10 p-12 text-center">
                <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <p className="text-gray-400">No customers found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customers.map((customer) => (
                  <div key={customer.contact_id} className="bg-white/5 rounded-lg border border-white/10 p-6 hover:border-rose-500/50 transition-colors">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="text-white font-semibold">{customer.contact_name}</h4>
                        {customer.company_name && <p className="text-sm text-gray-400">{customer.company_name}</p>}
                      </div>
                      <button className="p-2 hover:bg-white/10 rounded transition-colors">
                        <Edit2 className="w-4 h-4 text-gray-400" />
                      </button>
                    </div>
                    <div className="space-y-2 text-sm">
                      {customer.email && (
                        <p className="text-gray-400 flex items-center gap-2">
                          <Mail className="w-4 h-4" /> {customer.email}
                        </p>
                      )}
                      {customer.phone && (
                        <p className="text-gray-400 flex items-center gap-2">
                          <FileText className="w-4 h-4" /> {customer.phone}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Expenses Tab */}
        {activeTab === 'expenses' && (
          <div className="space-y-6">
            <button
              onClick={() => setShowNewExpenseModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors font-semibold"
            >
              <Plus className="w-4 h-4" />
              New Expense
            </button>

            {loadingExpenses ? (
              <div className="text-center py-12">
                <Zap className="w-8 h-8 text-rose-400 mx-auto mb-4 animate-spin" />
                <p className="text-gray-400">Loading expenses...</p>
              </div>
            ) : expenses.length === 0 ? (
              <div className="bg-white/5 rounded-lg border border-white/10 p-12 text-center">
                <TrendingUp className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <p className="text-gray-400">No expenses found</p>
              </div>
            ) : (
              <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-white/10 border-b border-white/10">
                    <tr>
                      <th className="px-6 py-3 text-left text-white font-semibold">Vendor</th>
                      <th className="px-6 py-3 text-left text-white font-semibold">Amount</th>
                      <th className="px-6 py-3 text-left text-white font-semibold">Status</th>
                      <th className="px-6 py-3 text-left text-white font-semibold">Date</th>
                      <th className="px-6 py-3 text-left text-white font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {expenses.map((expense) => (
                      <tr key={expense.expense_id} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-3 text-white">{expense.vendor_name}</td>
                        <td className="px-6 py-3 text-white font-semibold">${expense.amount}</td>
                        <td className="px-6 py-3">
                          <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-300">
                            {expense.status}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-gray-300">{new Date(expense.expense_date).toLocaleDateString()}</td>
                        <td className="px-6 py-3 flex gap-2">
                          <button className="p-2 hover:bg-white/10 rounded transition-colors">
                            <Eye className="w-4 h-4 text-gray-400" />
                          </button>
                          <button className="p-2 hover:bg-white/10 rounded transition-colors">
                            <Edit2 className="w-4 h-4 text-gray-400" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            {loadingReports ? (
              <div className="text-center py-12">
                <Zap className="w-8 h-8 text-rose-400 mx-auto mb-4 animate-spin" />
                <p className="text-gray-400">Loading reports...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white/5 rounded-xl border border-white/10 p-6">
                  <h3 className="text-xl font-bold text-white mb-6">Profit & Loss</h3>
                  {reports && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                        <span className="text-gray-400">Total Income</span>
                        <span className="text-white font-semibold">${reports.total_income || 0}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                        <span className="text-gray-400">Total Expenses</span>
                        <span className="text-white font-semibold">${reports.total_expenses || 0}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                        <span className="text-emerald-300 font-semibold">Net Profit</span>
                        <span className="text-emerald-300 font-bold text-lg">${reports.net_profit || 0}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-white/5 rounded-xl border border-white/10 p-6">
                  <h3 className="text-xl font-bold text-white mb-6">Balance Sheet</h3>
                  {reports && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                        <span className="text-gray-400">Total Assets</span>
                        <span className="text-white font-semibold">${reports.total_assets || 0}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                        <span className="text-gray-400">Total Liabilities</span>
                        <span className="text-white font-semibold">${reports.total_liabilities || 0}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* New Invoice Modal */}
        {showNewInvoiceModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-xl border border-white/10 w-full max-w-lg max-h-96 overflow-y-auto">
              <div className="p-6 border-b border-white/10 flex items-center justify-between sticky top-0 bg-slate-800">
                <h3 className="text-xl font-bold text-white">Create New Invoice</h3>
                <button
                  onClick={() => setShowNewInvoiceModal(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateInvoice} className="p-6 space-y-4">
                {customers.length === 0 ? (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-yellow-300 text-sm mb-4">
                    <p className="font-medium mb-2">⚠️ No customers found</p>
                    <p>Please create at least one customer before creating an invoice. Go to the Customers tab and click "New Customer".</p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Customer *
                    </label>
                    <select
                      value={invoiceForm.customer_id}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, customer_id: e.target.value })}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                    >
                      <option value="">Select a customer</option>
                      {customers.map((customer) => (
                        <option key={customer.contact_id} value={customer.contact_id}>
                          {customer.contact_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Description *
                  </label>
                  <input
                    type="text"
                    value={invoiceForm.description}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })}
                    placeholder="Item description"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Quantity *
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={invoiceForm.quantity}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, quantity: parseFloat(e.target.value) || 1 })}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Rate *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={invoiceForm.rate}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, rate: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Invoice Date
                    </label>
                    <input
                      type="date"
                      value={invoiceForm.invoice_date}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_date: e.target.value })}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-rose-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={invoiceForm.due_date}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-rose-500 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Notes
                  </label>
                  <textarea
                    value={invoiceForm.notes}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })}
                    placeholder="Add any notes..."
                    rows={2}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowNewInvoiceModal(false)}
                    className="flex-1 px-4 py-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingInvoice || customers.length === 0}
                    className="flex-1 px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    {savingInvoice && <Zap className="w-4 h-4 animate-spin" />}
                    {savingInvoice ? 'Creating...' : 'Create Invoice'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* New Customer Modal */}
        {showNewCustomerModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-xl border border-white/10 w-full max-w-lg">
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white">Create New Customer</h3>
                <button
                  onClick={() => setShowNewCustomerModal(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateCustomer} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Customer Name *
                  </label>
                  <input
                    type="text"
                    value={customerForm.contact_name}
                    onChange={(e) => setCustomerForm({ ...customerForm, contact_name: e.target.value })}
                    placeholder="John Doe"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={customerForm.company_name}
                    onChange={(e) => setCustomerForm({ ...customerForm, company_name: e.target.value })}
                    placeholder="Your Company Inc."
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={customerForm.email}
                    onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                    placeholder="john@example.com"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={customerForm.phone}
                    onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                    placeholder="+1 (555) 123-4567"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowNewCustomerModal(false)}
                    className="flex-1 px-4 py-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingCustomer}
                    className="flex-1 px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    {savingCustomer && <Zap className="w-4 h-4 animate-spin" />}
                    {savingCustomer ? 'Creating...' : 'Create Customer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* New Expense Modal */}
        {showNewExpenseModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-xl border border-white/10 w-full max-w-lg">
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white">Create New Expense</h3>
                <button
                  onClick={() => setShowNewExpenseModal(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateExpense} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Vendor Name *
                  </label>
                  <input
                    type="text"
                    value={expenseForm.vendor_name}
                    onChange={(e) => setExpenseForm({ ...expenseForm, vendor_name: e.target.value })}
                    placeholder="Vendor name"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Amount *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Expense Date *
                  </label>
                  <input
                    type="date"
                    value={expenseForm.expense_date}
                    onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Account ID (from Zoho Books)
                  </label>
                  <input
                    type="text"
                    value={expenseForm.account_id}
                    onChange={(e) => setExpenseForm({ ...expenseForm, account_id: e.target.value })}
                    placeholder="e.g., 1234567890"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Find the account ID in your Zoho Books account settings under Chart of Accounts
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Notes
                  </label>
                  <textarea
                    value={expenseForm.notes}
                    onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })}
                    placeholder="Add any notes..."
                    rows={2}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowNewExpenseModal(false)}
                    className="flex-1 px-4 py-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingExpense}
                    className="flex-1 px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    {savingExpense && <Zap className="w-4 h-4 animate-spin" />}
                    {savingExpense ? 'Creating...' : 'Create Expense'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
