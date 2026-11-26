import { useEffect, useRef, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, SignedIn, SignedOut, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { shadcn } from '@clerk/themes';
import {
  useGetMyAppProfile, getGetMyAppProfileQueryKey, useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useListBranches, getListBranchesQueryKey, useCreateBranch, useUpdateBranch,
  useListAppUsers, getListAppUsersQueryKey, useUpdateAppUser,
  useListUserInvitations, getListUserInvitationsQueryKey, useCreateUserInvitation, useRevokeUserInvitation,
  useListCustomers, getListCustomersQueryKey, useCreateCustomer, useGetCustomer, getGetCustomerQueryKey, useUpdateCustomer,
  useListOrders, getListOrdersQueryKey, useCreateOrder, useFindPossibleDuplicateOrders, getFindPossibleDuplicateOrdersQueryKey,
  useGetOrder, getGetOrderQueryKey, useUpdateOrder, useLinkIncomingReference, useAddOrderAttachment, useUpdateOrderItem,
  useListOrderActivity, getListOrderActivityQueryKey, useRequestUploadUrl, useGetPrivateStorageObject, getGetPrivateStorageObjectQueryKey,
} from '@workspace/api-client-react';
import { Link, Route, Switch, Redirect, Router as WouterRouter, useLocation, useParams } from 'wouter';
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowUpRight, Building2, Check, CircleAlert,
  ClipboardList, FileText, LayoutDashboard, LoaderCircle, LogOut, PackageCheck, Plus, Search,
  Settings2, ShieldCheck, Store, Upload, UsersRound, X,
} from 'lucide-react';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/index.css';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;

const copy: Record<string, string> = {
  new: 'جديد', in_progress: 'قيد العمل', partially_ready: 'جاهز جزئياً', ready: 'جاهز',
  partially_delivered: 'تم التسليم جزئياً', completed: 'مكتمل', on_hold: 'معلّق', cancelled: 'ملغي',
  whatsapp: 'واتساب', messenger: 'ماسنجر', phone: 'اتصال هاتفي', manager_phone: 'هاتف المدير',
  in_person: 'حضوري', internal: 'داخلي', other: 'أخرى',
  not_required: 'غير مطلوب', waiting: 'بانتظار التصميم', under_review: 'مراجعة', requires_revision: 'يتطلب تعديلاً',
  approved: 'معتمد', not_started: 'لم يبدأ', delivered: 'تم التسليم',
};
const roleNames: Record<string, string> = {
  admin: 'مدير النظام', manager: 'مدير', order_reception: 'استقبال الطلبات', designer: 'مصمم',
  production_employee: 'موظف إنتاج', accountant: 'محاسب', delivery_coordinator: 'منسق تسليم',
};
const statusClass = (s: string) => ['on_hold', 'cancelled'].includes(s) ? 'badge badge-red' :
  ['new', 'in_progress', 'partially_ready'].includes(s) ? 'badge badge-warn' : 'badge';
const displayStatus = (s?: string | null) => s ? copy[s] || s : '—';
const niceDate = (d?: string | null) => d ? new Intl.DateTimeFormat('ar', { dateStyle: 'medium' }).format(new Date(d)) : 'غير محدد';
const errText = (e: unknown) => e instanceof Error ? e.message : 'تعذّر إتمام العملية. حاول مرة أخرى.';

function Busy({ label = 'جارٍ تحميل البيانات' }: { label?: string }) {
  return <div className="panel" aria-live="polite"><div className="skeleton" /><p style={{ textAlign: 'center', color: '#718080' }}>{label}</p></div>;
}
function ErrorBox({ retry }: { retry?: () => void }) {
  return <div className="panel empty-state"><div className="empty-mark"><CircleAlert /></div><h3>تعذّر تحميل البيانات</h3><p>تحقق من الاتصال ثم أعد المحاولة.</p>{retry && <button className="btn btn-outline" onClick={retry} data-testid="button-retry">إعادة المحاولة</button>}</div>;
}
function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark"><FileText size={25} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
function PageTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}
function ClerkCacheReset() {
  const clerk = useClerk();
  const qc = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const stop = clerk.addListener(({ user }: { user?: { id?: string } | null }) => {
      const id = user?.id ?? null;
      if (previous.current !== undefined && previous.current !== id) qc.clear();
      previous.current = id;
    });
    return stop;
  }, [clerk, qc]);
  return null;
}
function Home() {
  return <div className="welcome" dir="rtl">
    <section className="welcome-aside">
      <div className="brand-row" style={{ border: 0, padding: 0 }}><div className="brand-mark">خ</div><div><strong>مطبعة ابن خلدون</strong><div style={{ fontSize: 12, color: '#bfd0cb' }}>نظام متابعة الطلبات</div></div></div>
      <div className="welcome-copy"><div className="badge" style={{ background: '#31535a', color: '#d3e4dc' }}>للاستخدام الداخلي</div><h1>من استلام الطلب<br />إلى جاهزية التسليم.</h1><p>مساحة عمل فريق مطبعة ابن خلدون. سجّل الطلبات، تابع تقدم كل منتج، وابقَ على اطلاع بآخر المستجدات.</p></div>
      <div style={{ color: '#b9cbc5', fontSize: 13, position: 'relative', zIndex: 1 }}>إدارة موحّدة لفروع وفريق المطبعة</div>
    </section>
    <section className="welcome-main"><div className="welcome-card"><div className="brand-mark" style={{ marginBottom: 25 }}>خ</div><h2>مرحباً بكم</h2><p>سجّل الدخول بحساب العمل للانتقال إلى مساحة الفريق. الوصول إلى النظام مخصص لموظفي المطبعة.</p><Link href="/sign-in" className="btn btn-primary" style={{ width: '100%', minHeight: 52 }} data-testid="link-signin">تسجيل الدخول <ArrowLeft size={18} /></Link><div style={{ marginTop: 19, padding: 15, borderRadius: 11, background: '#ecefe8', color: '#61716f', fontSize: 13, lineHeight: 1.8 }}><ShieldCheck size={17} style={{ verticalAlign: 'middle', marginLeft: 7 }} />إذا لم يكن لديك حساب، تواصل مع مدير النظام لطلب الدعوة.</div></div></section>
  </div>;
}
function AuthStatus() {
  const { data, isLoading, isError, refetch } = useGetMyAppProfile();
  if (isLoading) return <main className="page-content"><Busy label="جارٍ التحقق من صلاحية الوصول" /></main>;
  if (isError) return <main className="page-content"><ErrorBox retry={() => void refetch()} /></main>;
  const pending = data?.state === 'pending_invitation';
  const needsSetup = data?.state === 'setup_required';
  return <div className="welcome" dir="rtl"><section className="welcome-aside"><div className="brand-row" style={{ border: 0 }}><div className="brand-mark">خ</div><strong>مطبعة ابن خلدون</strong></div><div className="welcome-copy"><h1>{pending ? 'حسابك بانتظار التفعيل.' : 'نجهّز مساحة العمل.'}</h1><p>{pending ? 'تم استلام طلب الوصول. سيمنحك مدير النظام صلاحية الدخول عند اكتمال إعداد حسابك.' : 'لم يكتمل إعداد وصول الشركة بعد. يرجى التواصل مع مدير النظام.'}</p></div><div>بوابة فريق العمل</div></section><section className="welcome-main"><div className="panel" style={{ maxWidth: 420 }}><div className="empty-mark"><ShieldCheck /></div><h2 style={{ marginTop: 0 }}>{pending ? 'دعوة قيد الانتظار' : 'الإعداد مطلوب'}</h2><p style={{ color: '#718080', lineHeight: 1.8 }}>لا يمكن عرض بيانات العمل قبل تفعيل الوصول. إذا كنت تتوقع صلاحية نشطة، تواصل مع مسؤول النظام.</p><button className="btn btn-outline" onClick={() => void refetch()} data-testid="button-check-access">التحقق مجدداً</button></div></section></div>;
}
function SignInPage() { return <div className="welcome-main" style={{ minHeight: '100dvh' }}><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>; }
function SignUpPage() { return <div className="welcome-main" style={{ minHeight: '100dvh' }}><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>; }

const navigation = [
  ['/dashboard', 'الرئيسية', LayoutDashboard], ['/orders', 'الطلبات', ClipboardList],
  ['/customers', 'العملاء', UsersRound], ['/branches', 'الفروع', Store], ['/team', 'الفريق والصلاحيات', Building2],
] as const;
function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const clerk = useClerk();
  const profile = useGetMyAppProfile();
  if (profile.isLoading) return <div className="page-content"><Busy label="جارٍ فتح مساحة العمل" /></div>;
  if (profile.isError || profile.data?.state !== 'active') return <AuthStatus />;
  const user = profile.data.user;
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || '';
  return <div className="app-shell" dir="rtl">
    <aside className="sidebar"><div className="brand-row"><div className="brand-mark">خ</div><div><strong>ابن خلدون</strong><div style={{ fontSize: 11, color: '#b9cbc5' }}>إدارة الطلبات</div></div></div><nav className="nav-links">{navigation.map(([href, label, Icon]) => <Link href={href} key={href} className={`nav-link ${path === href || (href === '/orders' && path.startsWith('/orders')) ? 'active' : ''}`} data-testid={`link-nav-${href.slice(1)}`}><Icon size={19} />{label}</Link>)}</nav><div className="sidebar-foot"><div style={{ fontWeight: 700, color: '#f5f1e7' }}>{fullName}</div><div>{roleNames[user?.role || ''] || user?.role}</div><button className="nav-link" style={{ marginTop: 16, width: '100%', background: 'transparent', border: 0, cursor: 'pointer' }} onClick={() => void clerk.signOut({ redirectUrl: basePath || '/' })} data-testid="button-signout"><LogOut size={17} />تسجيل الخروج</button></div></aside>
    <div className="workspace"><header className="topbar"><div className="inline" style={{ color: '#60716f', fontSize: 14 }}><span style={{ width: 8, height: 8, borderRadius: 50, background: '#60a08b' }} />مساحة عمل مطبعة ابن خلدون</div><div className="inline"><span style={{ color: '#203b45', fontWeight: 700 }}>{fullName}</span><span className="badge">{roleNames[user?.role || ''] || user?.role}</span></div></header><main className="page-content">{children}</main></div>
    <nav className="mobile-nav">{navigation.slice(0, 4).map(([href, label, Icon]) => <Link href={href} key={href} className={path === href ? 'active' : ''} data-testid={`mobile-nav-${href.slice(1)}`}><Icon size={19} />{label}</Link>)}</nav>
  </div>;
}
function Protected({ children }: { children: ReactNode }) {
  return <SignedIn><Shell>{children}</Shell></SignedIn>;
}
function Dashboard() {
  const q = useGetDashboardSummary();
  const data = q.data;
  const metrics = [
    ['إجمالي الطلبات', data?.totalOrders, ClipboardList], ['طلبات قيد التنفيذ', data?.activeOrders, Activity],
    ['بانتظار مسؤول', data?.ordersAwaitingAssignment, UsersRound], ['طلبات جاهزة', data?.readyOrders, PackageCheck],
  ] as const;
  return <><PageTitle title="الرئيسية" subtitle="ملخص الطلبات وسير العمل في الفروع." action={<Link href="/orders/new" className="btn btn-primary" data-testid="button-new-order"><Plus size={18} />طلب جديد</Link>} />
    {q.isLoading ? <div className="metric-grid">{metrics.map(([label]) => <div className="skeleton" key={label} />)}</div> : q.isError ? <ErrorBox retry={() => void q.refetch()} /> : <div className="metric-grid">{metrics.map(([label, value, Icon]) => <div className="metric" key={label}><div className="metric-label">{label}<span className="metric-icon"><Icon size={18} /></span></div><div className="metric-value" data-testid={`metric-${label}`}>{value ?? 0}</div></div>)}</div>}
    {!q.isLoading && !q.isError && data && data.totalOrders === 0 && <div className="panel"><Empty title="لا توجد طلبات مسجلة" detail="ستظهر مؤشرات الطلبات هنا بعد تسجيل أول طلب للشركة." action={<Link href="/orders/new" className="btn btn-primary">تسجيل أول طلب</Link>} /></div>}
    {!q.isLoading && !q.isError && data && <div className="panel" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}><div style={{ flex: 1, minWidth: 170 }}><div className="metric-label">العملاء المسجلون</div><strong style={{ fontSize: 24 }}>{data.totalCustomers}</strong></div><div style={{ flex: 1, minWidth: 170 }}><div className="metric-label">الفروع النشطة</div><strong style={{ fontSize: 24 }}>{data.totalBranches}</strong></div><Link href="/orders" className="btn btn-quiet">عرض الطلبات <ArrowUpRight size={17} /></Link></div>}
  </>;
}
function Orders() {
  const [search, setSearch] = useState('');
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState('');
  const params = useMemo(() => ({ search: search || undefined, status: status ? status as never : undefined, limit: 100 }), [search, status]);
  const q = useListOrders(params);
  const statusOptions = ['new', 'in_progress', 'partially_ready', 'ready', 'partially_delivered', 'completed', 'on_hold', 'cancelled'];
  return <><PageTitle title="الطلبات" subtitle="ابحث عن طلب وتابع حالته والمسؤول عنه." action={<Link href="/orders/new" className="btn btn-primary" data-testid="button-new-order"><Plus size={18} />طلب جديد</Link>} />
    <div className="toolbar"><div style={{ position: 'relative', flex: 1 }}><Search size={18} style={{ position: 'absolute', right: 13, top: 14, color: '#758480' }} /><input className="input" style={{ paddingRight: 40 }} placeholder="رقم الطلب أو اسم العميل" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-orders" /></div><select className="select" style={{ maxWidth: 230 }} value={status} onChange={e => setStatus(e.target.value)} data-testid="select-order-status"><option value="">كل الحالات</option>{statusOptions.map(s => <option value={s} key={s}>{displayStatus(s)}</option>)}</select></div>
    {q.isLoading ? <Busy /> : q.isError ? <ErrorBox retry={() => void q.refetch()} /> : !q.data?.length ? <div className="panel"><Empty title={search || status ? 'لا توجد نتائج مطابقة' : 'لا توجد طلبات حتى الآن'} detail={search || status ? 'جرّب تغيير كلمات البحث أو حالة الطلب.' : 'سيظهر هنا كل طلب جديد يتم تسجيله في النظام.'} action={!search && !status ? <Link href="/orders/new" className="btn btn-primary">إنشاء طلب</Link> : undefined} /></div> :
      <div className="table-wrap"><table><thead><tr><th>رقم الطلب</th><th>العميل</th><th>الفرع</th><th>الحالة</th><th>المسؤول</th><th>موعد التسليم</th></tr></thead><tbody>{q.data.map(o => <tr key={o.id} data-clickable="true" onClick={() => setLocation(`/orders/${o.id}`)} data-testid={`row-order-${o.id}`}><td style={{ fontWeight: 700, color: '#286d64' }}>{o.orderNumber}</td><td>{o.customer.name}</td><td>{o.branch.name}</td><td><span className={statusClass(o.status)}>{displayStatus(o.status)}</span></td><td>{o.responsibleUser ? [o.responsibleUser.firstName, o.responsibleUser.lastName].filter(Boolean).join(' ') || o.responsibleUser.email : 'غير معيّن'}</td><td>{niceDate(o.requestedDeliveryDate)}</td></tr>)}</tbody></table></div>}
  </>;
}
type ItemDraft = { productName: string; quantity: string; unit: string; specifications: string; dimensions: string; material: string; designRequired: boolean };
const blankItem = (): ItemDraft => ({ productName: '', quantity: '1', unit: '', specifications: '', dimensions: '', material: '', designRequired: false });
function NewOrder() {
  const qc = useQueryClient(); const [, setLoc] = useLocation();
  const [customerId, setCustomerId] = useState(''); const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [customerName, setCustomerName] = useState(''); const [phone, setPhone] = useState('');
  const [branchId, setBranchId] = useState(''); const [source, setSource] = useState('whatsapp'); const [sourceDetails, setSourceDetails] = useState('');
  const [delivery, setDelivery] = useState(''); const [notes, setNotes] = useState(''); const [items, setItems] = useState<ItemDraft[]>([blankItem()]);
  const [files, setFiles] = useState<File[]>([]); const [formError, setFormError] = useState('');
  const customers = useListCustomers({ limit: 100 }); const branches = useListBranches({ includeInactive: false });
  const createCustomer = useCreateCustomer(); const createOrder = useCreateOrder(); const requestUpload = useRequestUploadUrl(); const attach = useAddOrderAttachment();
  const duplicates = useFindPossibleDuplicateOrders({ phone }, { query: { enabled: phone.replace(/\D/g, '').length >= 7, queryKey: getFindPossibleDuplicateOrdersQueryKey({ phone }) } });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setFormError('');
    try {
      if (!items.length || items.some(i => !i.productName.trim() || Number(i.quantity) <= 0)) { setFormError('أضف منتجاً واحداً على الأقل وتأكد من صحة الكمية.'); return; }
      let id = Number(customerId);
      if (isNewCustomer) {
        if (!customerName.trim()) { setFormError('اكتب اسم العميل.'); return; }
        const c = await createCustomer.mutateAsync({ data: { name: customerName.trim(), phone: phone || null } });
        id = c.id;
        await qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      }
      if (!id || !branchId) { setFormError('اختر العميل والفرع قبل المتابعة.'); return; }
      const order = await createOrder.mutateAsync({ data: { customerId: id, branchId: Number(branchId), source: source as never, sourceDetails: sourceDetails || null, requestedDeliveryDate: delivery || null, notes: notes || null, items: items.map(i => ({ productName: i.productName.trim(), quantity: Number(i.quantity), unit: i.unit || null, specifications: i.specifications || null, dimensions: i.dimensions || null, material: i.material || null, designRequired: i.designRequired })) } });
      for (const file of files) {
        const uploaded = await requestUpload.mutateAsync({ data: { orderId: order.id, name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' } });
        const response = await fetch(uploaded.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        if (!response.ok) throw new Error(`تعذّر رفع الملف ${file.name}`);
        await attach.mutateAsync({ orderId: order.id, data: { fileName: file.name, objectPath: uploaded.objectPath, contentType: file.type || 'application/octet-stream', fileSize: file.size } });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: getListOrdersQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }), qc.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) })]);
      setLoc(`/orders/${order.id}`);
    } catch (err) { setFormError(errText(err)); }
  };
  const busy = createOrder.isPending || createCustomer.isPending || requestUpload.isPending || attach.isPending;
  return <><PageTitle title="طلب جديد" subtitle="سجّل العميل والتفاصيل الأساسية، ثم أضف المنتجات والملفات الأصلية." action={<Link href="/orders" className="btn btn-outline"><ArrowLeft size={17} />العودة</Link>} />
    <form className="panel" onSubmit={submit}>
      <div className="form-grid">
        <div className="field"><label>العميل</label>{isNewCustomer ? <div className="inline"><input required className="input" placeholder="اسم العميل" value={customerName} onChange={e => setCustomerName(e.target.value)} data-testid="input-new-customer-name" /><button type="button" className="btn btn-quiet" onClick={() => setIsNewCustomer(false)}>اختيار مسجل</button></div> : <div className="inline"><select className="select" value={customerId} onChange={e => setCustomerId(e.target.value)} data-testid="select-order-customer"><option value="">اختر العميل</option>{(customers.data || []).map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}</select><button type="button" className="btn btn-quiet" onClick={() => setIsNewCustomer(true)}><Plus size={16} />عميل جديد</button></div>}</div>
        <div className="field"><label>رقم الهاتف <span style={{ color: '#758480', fontWeight: 400 }}>للتواصل والتحقق من طلبات سابقة</span></label><input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="رقم الهاتف" data-testid="input-order-phone" /></div>
        <div className="field"><label>الفرع</label><select required className="select" value={branchId} onChange={e => setBranchId(e.target.value)} data-testid="select-order-branch"><option value="">اختر الفرع</option>{(branches.data || []).filter(b => b.isActive).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div className="field"><label>مصدر الطلب</label><select className="select" value={source} onChange={e => setSource(e.target.value)} data-testid="select-order-source">{['whatsapp','messenger','phone','manager_phone','in_person','internal','other'].map(s => <option key={s} value={s}>{displayStatus(s)}</option>)}</select></div>
        <div className="field"><label>تفاصيل المصدر</label><input className="input" value={sourceDetails} onChange={e => setSourceDetails(e.target.value)} placeholder="مثال: اسم جهة التواصل" data-testid="input-source-details" /></div>
        <div className="field"><label>موعد التسليم المطلوب</label><input type="date" className="input" value={delivery} onChange={e => setDelivery(e.target.value)} data-testid="input-requested-date" /></div>
      </div>
      {!!duplicates.data?.length && <div style={{ background: '#f8f0e2', border: '1px solid #ead9b8', borderRadius: 12, padding: 14, marginBottom: 16 }}><strong>طلبات محتملة مرتبطة بهذا الرقم</strong><p style={{ margin: '5px 0 9px', color: '#74634b' }}>هذه اقتراحات للمراجعة فقط. لن يتم دمج أي سجل تلقائياً.</p>{duplicates.data.map(d => <div key={d.order.id} style={{ marginTop: 6 }}>{d.order.orderNumber} · {d.order.customer.name} · {displayStatus(d.order.status)} <small>({d.matchReason})</small></div>)}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}><h2 style={{ fontSize: 20, margin: 0 }}>المنتجات المطلوبة</h2><button type="button" className="btn btn-quiet" onClick={() => setItems([...items, blankItem()])} data-testid="button-add-item"><Plus size={17} />إضافة منتج</button></div>
      {items.map((it, i) => <div className="item-form" key={i}><div className="item-head"><strong>المنتج {i + 1}</strong>{items.length > 1 && <button type="button" className="btn btn-danger" onClick={() => setItems(items.filter((_, idx) => idx !== i))} aria-label="حذف المنتج"><X size={17} />حذف</button>}</div><div className="form-grid">
        <div className="field"><label>اسم المنتج</label><input required className="input" value={it.productName} onChange={e => setItems(items.map((x, n) => n === i ? { ...x, productName: e.target.value } : x))} data-testid={`input-item-name-${i}`} /></div>
        <div className="field"><label>الكمية</label><div className="inline"><input type="number" min="1" required className="input" value={it.quantity} onChange={e => setItems(items.map((x, n) => n === i ? { ...x, quantity: e.target.value } : x))} /><input className="input" placeholder="الوحدة (اختياري)" value={it.unit} onChange={e => setItems(items.map((x, n) => n === i ? { ...x, unit: e.target.value } : x))} /></div></div>
        <div className="field"><label>المقاس</label><input className="input" value={it.dimensions} onChange={e => setItems(items.map((x, n) => n === i ? { ...x, dimensions: e.target.value } : x))} /></div>
        <div className="field"><label>الخامة</label><input className="input" value={it.material} onChange={e => setItems(items.map((x, n) => n === i ? { ...x, material: e.target.value } : x))} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>المواصفات</label><textarea className="textarea" value={it.specifications} onChange={e => setItems(items.map((x, n) => n === i ? { ...x, specifications: e.target.value } : x))} /></div>
        <label className="inline" style={{ marginBottom: 12 }}><input type="checkbox" checked={it.designRequired} onChange={e => setItems(items.map((x, n) => n === i ? { ...x, designRequired: e.target.checked } : x))} />يتطلب تصميماً</label>
      </div></div>)}
      <div className="field"><label>ملاحظات عامة</label><textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} /></div>
      <div className="field"><label>الملفات الأصلية</label><input type="file" multiple className="input" onChange={e => setFiles(Array.from(e.target.files || []))} data-testid="input-order-files" /><small style={{ color: '#718080' }}>تُرفع الملفات إلى التخزين الخاص ثم تُربط بالطلب بعد حفظه.</small></div>
      {formError && <p role="alert" style={{ color: '#a64434' }}>{formError}</p>}
      <div className="inline"><button className="btn btn-primary" disabled={busy} data-testid="button-save-order">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <Check size={18} />}حفظ الطلب</button><Link href="/orders" className="btn btn-outline">إلغاء</Link></div>
    </form>
  </>;
}
function AttachmentLink({ attachment }: { attachment: { objectPath: string; fileName: string } }) {
  const [enabled, setEnabled] = useState(false);
  const q = useGetPrivateStorageObject(attachment.objectPath.replace(/^\/objects\//, ''), { query: { enabled, queryKey: getGetPrivateStorageObjectQueryKey(attachment.objectPath.replace(/^\/objects\//, '')) } });
  useEffect(() => {
    if (!enabled || !q.data) return;
    const url = URL.createObjectURL(q.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.fileName;
    a.click();
    URL.revokeObjectURL(url);
    setEnabled(false);
  }, [enabled, q.data, attachment.fileName]);
  const download = () => {
    setEnabled(true);
  };
  return <button className="btn btn-outline" onClick={download} disabled={q.isLoading} data-testid={`button-file-${attachment.fileName}`}>{q.isLoading ? <LoaderCircle size={16} /> : <ArrowDownToLine size={16} />}{attachment.fileName}</button>;
}
function OrderDetail() {
  const { orderId = '' } = useParams<{ orderId: string }>(); const id = Number(orderId);
  const qc = useQueryClient(); const q = useGetOrder(id); const activity = useListOrderActivity(id, { query: { queryKey: getListOrderActivityQueryKey(id) } });
  const team = useListAppUsers();
  const updateOrder = useUpdateOrder(); const linkRef = useLinkIncomingReference(); const updateItem = useUpdateOrderItem();
  const [referenceSource, setReferenceSource] = useState('whatsapp'); const [referenceDetails, setReferenceDetails] = useState(''); const [error, setError] = useState('');
  const invalidate = async () => { await Promise.all([qc.invalidateQueries({ queryKey: getGetOrderQueryKey(id) }), qc.invalidateQueries({ queryKey: getListOrderActivityQueryKey(id) }), qc.invalidateQueries({ queryKey: getListOrdersQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })]); };
  if (q.isLoading) return <Busy />; if (q.isError || !q.data) return <ErrorBox retry={() => void q.refetch()} />;
  const o = q.data;
  const onReference = async (e: FormEvent) => { e.preventDefault(); setError(''); try { await linkRef.mutateAsync({ orderId: id, data: { source: referenceSource as never, referenceDetails: referenceDetails || null } }); setReferenceDetails(''); await invalidate(); } catch (err) { setError(errText(err)); } };
  const orderStatusOptions = ['none','on_hold','cancelled'];
  return <><PageTitle title={`طلب ${o.orderNumber}`} subtitle={`${o.customer.name} · ${o.branch.name}`} action={<Link href="/orders" className="btn btn-outline"><ArrowLeft size={17} />كل الطلبات</Link>} />
    <div className="order-layout"><div className="stack">
      <section className="panel"><div className="inline" style={{ justifyContent: 'space-between', marginBottom: 12 }}><h2 style={{ margin: 0, fontSize: 20 }}>ملخص الطلب</h2><span className={statusClass(o.status)}>{displayStatus(o.status)}</span></div><div className="meta-row"><span>العميل</span><strong>{o.customer.name}</strong></div><div className="meta-row"><span>الفرع</span><strong>{o.branch.name}</strong></div><div className="meta-row"><span>مصدر الطلب</span><strong>{displayStatus(o.source)} {o.sourceDetails || ''}</strong></div><div className="form-grid" style={{ marginTop: 12 }}><div className="field"><label>المسؤول عن الطلب</label><select className="select" value={o.responsibleUser?.id || ''} onChange={async e => { try { await updateOrder.mutateAsync({ orderId: id, data: { responsibleUserId: e.target.value || null } }); await invalidate(); } catch (err) { setError(errText(err)); } }} data-testid="select-order-owner"><option value="">غير معيّن</option>{(team.data || []).filter(u => u.status === 'active').map(u => <option value={u.id} key={u.id}>{[u.firstName,u.lastName].filter(Boolean).join(' ') || u.email}</option>)}</select></div><div className="field"><label>موعد التسليم المطلوب</label><input type="date" className="input" defaultValue={o.requestedDeliveryDate?.slice(0,10) || ''} onBlur={async e => { const value = e.target.value || null; if (value === (o.requestedDeliveryDate?.slice(0,10) || null)) return; try { await updateOrder.mutateAsync({ orderId: id, data: { requestedDeliveryDate: value } }); await invalidate(); } catch (err) { setError(errText(err)); } }} data-testid="input-order-delivery-date" /></div></div><div className="meta-row"><span>تاريخ التسجيل</span><strong>{niceDate(o.createdAt)}</strong></div>{o.notes && <p>{o.notes}</p>}<div className="inline" style={{ marginTop: 16 }}><select id="override-status" className="select" style={{ maxWidth: 210 }} defaultValue="none">{orderStatusOptions.map(s => <option value={s} key={s}>{s === 'none' ? 'تغيير حالة الطلب' : displayStatus(s)}</option>)}</select><button className="btn btn-quiet" onClick={async () => { const el = document.getElementById('override-status') as HTMLSelectElement; try { await updateOrder.mutateAsync({ orderId: id, data: { statusOverride: el.value as never } }); await invalidate(); } catch (err) { setError(errText(err)); } }} disabled={updateOrder.isPending}>تطبيق حالة استثنائية</button></div></section>
      <section className="panel"><h2 style={{ fontSize: 20, marginTop: 0 }}>المنتجات والتقدم</h2>{o.items.map(item => <div className="item-form" key={item.id}><div className="inline" style={{ justifyContent: 'space-between' }}><strong>{item.productName}</strong><span className={statusClass(item.status)}>{displayStatus(item.status)}</span></div><div className="meta-row"><span>الكمية</span><strong>{item.quantity} {item.unit || ''}</strong></div>{item.dimensions && <div className="meta-row"><span>المقاس</span><strong>{item.dimensions}</strong></div>}{item.material && <div className="meta-row"><span>الخامة</span><strong>{item.material}</strong></div>}{item.specifications && <p>{item.specifications}</p>}<div className="form-grid"><div className="field"><label>حالة التصميم</label><select className="select" value={item.designStatus} onChange={async e => { try { await updateItem.mutateAsync({ itemId: item.id, data: { designStatus: e.target.value as never } }); await invalidate(); } catch (err) { setError(errText(err)); } }} data-testid={`select-design-status-${item.id}`}>{['not_required','waiting','in_progress','under_review','requires_revision','approved'].map(s => <option key={s} value={s}>{displayStatus(s)}</option>)}</select></div><div className="field"><label>حالة الإنتاج</label><select className="select" value={item.productionStatus} onChange={async e => { try { await updateItem.mutateAsync({ itemId: item.id, data: { productionStatus: e.target.value as never } }); await invalidate(); } catch (err) { setError(errText(err)); } }} data-testid={`select-production-status-${item.id}`}>{['not_started','in_progress','on_hold','ready'].map(s => <option key={s} value={s}>{displayStatus(s)}</option>)}</select></div><div className="field"><label>حالة المنتج</label><select className="select" value={item.status} onChange={async e => { try { await updateItem.mutateAsync({ itemId: item.id, data: { status: e.target.value as never } }); await invalidate(); } catch (err) { setError(errText(err)); } }} data-testid={`select-item-status-${item.id}`}>{['new','in_progress','ready','delivered','on_hold','cancelled'].map(s => <option key={s} value={s}>{displayStatus(s)}</option>)}</select></div></div></div>)}</section>
      <section className="panel"><h2 style={{ fontSize: 20, marginTop: 0 }}>الملفات المرفقة</h2>{o.attachments.length ? <div className="inline">{o.attachments.map(a => <AttachmentLink key={a.id} attachment={a} />)}</div> : <p style={{ color: '#718080' }}>لا توجد ملفات مرفقة بهذا الطلب.</p>}</section>
      <section className="panel"><h2 style={{ fontSize: 20, marginTop: 0 }}>المراجع الواردة</h2>{o.references.length ? o.references.map(r => <div className="meta-row" key={r.id}><span>{displayStatus(r.source)} · {niceDate(r.receivedAt)}</span><strong>{r.referenceDetails || 'بدون تفاصيل'}</strong></div>) : <p style={{ color: '#718080' }}>لا توجد مراجع مرتبطة.</p>}<form onSubmit={onReference} className="form-grid" style={{ marginTop: 18 }}><div className="field"><label>المصدر</label><select className="select" value={referenceSource} onChange={e => setReferenceSource(e.target.value)}>{['whatsapp','messenger','phone','manager_phone','in_person','internal','other'].map(s => <option key={s} value={s}>{displayStatus(s)}</option>)}</select></div><div className="field"><label>تفاصيل المرجع</label><input className="input" value={referenceDetails} onChange={e => setReferenceDetails(e.target.value)} placeholder="رابط أو وصف مختصر" /></div><div><button className="btn btn-quiet" disabled={linkRef.isPending}><Plus size={16} />ربط مرجع وارد</button></div></form></section>
    </div><aside className="stack"><section className="panel"><h2 style={{ fontSize: 19, marginTop: 0 }}>سجل النشاط</h2>{activity.isLoading ? <div className="skeleton" /> : activity.isError ? <p>تعذّر تحميل سجل النشاط.</p> : (activity.data || o.activity).length ? (activity.data || o.activity).map(a => <div className="activity-row" key={a.id}><span className="activity-dot" /><div><strong>{a.summary}</strong><div style={{ color: '#718080', fontSize: 12, marginTop: 4 }}>{niceDate(a.occurredAt)}</div></div></div>) : <p style={{ color: '#718080' }}>لا يوجد نشاط مسجل بعد.</p>}</section></aside></div>
    {error && <p role="alert" style={{ color: '#a64434', marginTop: 16 }}>{error}</p>}
  </>;
}
function Customers() {
  const qc = useQueryClient(); const [search, setSearch] = useState(''); const [showForm, setShowForm] = useState(false); const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [notes, setNotes] = useState(''); const [error, setError] = useState('');
  const q = useListCustomers({ search: search || undefined, limit: 100 }); const create = useCreateCustomer();
  const save = async (e: FormEvent) => { e.preventDefault(); setError(''); try { await create.mutateAsync({ data: { name: name.trim(), phone: phone || null, notes: notes || null } }); await qc.invalidateQueries({ queryKey: getListCustomersQueryKey() }); setName(''); setPhone(''); setNotes(''); setShowForm(false); } catch (err) { setError(errText(err)); } };
  return <><PageTitle title="العملاء" subtitle="سجّل العملاء وابحث في بيانات التواصل." action={<button className="btn btn-primary" onClick={() => setShowForm(!showForm)} data-testid="button-add-customer"><Plus size={18} />تسجيل عميل</button>} />
    {showForm && <form className="panel" onSubmit={save} style={{ marginBottom: 18 }}><div className="form-grid"><div className="field"><label>اسم العميل</label><input required className="input" value={name} onChange={e => setName(e.target.value)} data-testid="input-customer-name" /></div><div className="field"><label>الهاتف</label><input className="input" value={phone} onChange={e => setPhone(e.target.value)} data-testid="input-customer-phone" /></div><div className="field" style={{ gridColumn: '1/-1' }}><label>ملاحظات</label><textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} /></div></div>{error && <p role="alert">{error}</p>}<div className="inline"><button className="btn btn-primary" disabled={create.isPending}>حفظ العميل</button><button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>إلغاء</button></div></form>}
    <div className="toolbar"><div style={{ position: 'relative', flex: 1 }}><Search size={18} style={{ position: 'absolute', right: 13, top: 14, color: '#758480' }} /><input className="input" style={{ paddingRight: 40 }} placeholder="ابحث بالاسم أو الهاتف" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-customers" /></div></div>
    {q.isLoading ? <Busy /> : q.isError ? <ErrorBox retry={() => void q.refetch()} /> : !q.data?.length ? <div className="panel"><Empty title={search ? 'لا يوجد عميل مطابق' : 'لا يوجد عملاء مسجلون'} detail={search ? 'جرّب البحث بكلمة أخرى.' : 'أضف سجلات العملاء التي تستخدمها الشركة.'} action={!search ? <button className="btn btn-primary" onClick={() => setShowForm(true)}>تسجيل أول عميل</button> : undefined} /></div> : <div className="table-wrap"><table><thead><tr><th>اسم العميل</th><th>الهاتف</th><th>ملاحظات</th><th>تاريخ التسجيل</th></tr></thead><tbody>{q.data.map(c => <tr key={c.id}><td style={{ fontWeight: 700 }}><Link href={`/customers/${c.id}`} style={{ color: '#286d64', textDecoration: 'none' }} data-testid={`link-customer-${c.id}`}>{c.name}</Link></td><td>{c.phone || '—'}</td><td>{c.notes || '—'}</td><td>{niceDate(c.createdAt)}</td></tr>)}</tbody></table></div>}
  </>;
}
function Branches() {
  const qc = useQueryClient(); const [name, setName] = useState(''); const [error, setError] = useState('');
  const q = useListBranches({ includeInactive: true }); const create = useCreateBranch(); const update = useUpdateBranch();
  const save = async (e: FormEvent) => { e.preventDefault(); setError(''); try { await create.mutateAsync({ data: { name: name.trim() } }); setName(''); await qc.invalidateQueries({ queryKey: getListBranchesQueryKey({ includeInactive: true }) }); } catch (err) { setError(errText(err)); } };
  const edit = async (id: number, current: string) => { const next = window.prompt('اسم الفرع', current); if (next === null || !next.trim()) return; try { await update.mutateAsync({ branchId: id, data: { name: next.trim() } }); await qc.invalidateQueries({ queryKey: getListBranchesQueryKey({ includeInactive: true }) }); } catch (err) { setError(errText(err)); } };
  const toggle = async (id: number, isActive: boolean) => { try { await update.mutateAsync({ branchId: id, data: { isActive: !isActive } }); await qc.invalidateQueries({ queryKey: getListBranchesQueryKey({ includeInactive: true }) }); await qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); } catch (err) { setError(errText(err)); } };
  return <><PageTitle title="الفروع" subtitle="أضف فروع الشركة وعدّل بياناتها أو أوقفها عند الحاجة." /><form onSubmit={save} className="panel inline" style={{ marginBottom: 18 }}><input required className="input" style={{ maxWidth: 440 }} placeholder="اسم الفرع الجديد" value={name} onChange={e => setName(e.target.value)} data-testid="input-branch-name" /><button className="btn btn-primary" disabled={create.isPending}><Plus size={17} />إضافة فرع</button></form>{error && <p role="alert" style={{ color: '#a64434' }}>{error}</p>}
    {q.isLoading ? <Busy /> : q.isError ? <ErrorBox retry={() => void q.refetch()} /> : !q.data?.length ? <div className="panel"><Empty title="لم تتم إضافة فروع" detail="تظهر الفروع التي تسجلها الإدارة هنا." /></div> : <div className="table-wrap"><table><thead><tr><th>الفرع</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{q.data.map(b => <tr key={b.id}><td style={{ fontWeight: 700 }}>{b.name}</td><td><span className={b.isActive ? 'badge' : 'badge badge-muted'}>{b.isActive ? 'نشط' : 'غير نشط'}</span></td><td><div className="inline"><button className="btn btn-outline" onClick={() => void edit(b.id, b.name)} data-testid={`button-edit-branch-${b.id}`}><Settings2 size={16} />تعديل الاسم</button><button className={b.isActive ? 'btn btn-danger' : 'btn btn-quiet'} onClick={() => void toggle(b.id, b.isActive)} data-testid={`button-toggle-branch-${b.id}`}>{b.isActive ? 'إيقاف الفرع' : 'تفعيل الفرع'}</button></div></td></tr>)}</tbody></table></div>}
  </>;
}
function Team() {
  const qc = useQueryClient(); const branches = useListBranches({ includeInactive: false }); const users = useListAppUsers(); const invites = useListUserInvitations();
  const create = useCreateUserInvitation(); const revoke = useRevokeUserInvitation(); const update = useUpdateAppUser();
  const [email, setEmail] = useState(''); const [role, setRole] = useState('order_reception'); const [branchIds, setBranchIds] = useState<number[]>([]); const [error, setError] = useState('');
  const invite = async (e: FormEvent) => { e.preventDefault(); setError(''); try { await create.mutateAsync({ data: { email: email.trim(), role: role as never, branchIds } }); setEmail(''); await qc.invalidateQueries({ queryKey: getListUserInvitationsQueryKey() }); } catch (err) { setError(errText(err)); } };
  const revokeInvite = async (id: number) => { if (!window.confirm('هل تريد إلغاء هذه الدعوة؟')) return; try { await revoke.mutateAsync({ invitationId: id } as never); await qc.invalidateQueries({ queryKey: getListUserInvitationsQueryKey() }); } catch (err) { setError(errText(err)); } };
  const refresh = async () => Promise.all([qc.invalidateQueries({ queryKey: getListAppUsersQueryKey() }), qc.invalidateQueries({ queryKey: getListUserInvitationsQueryKey() })]);
  return <><PageTitle title="الفريق والصلاحيات" subtitle="إدارة حسابات العمل والدعوات وتعيين الدور والفروع." />
    <form className="panel" onSubmit={invite} style={{ marginBottom: 20 }}><h2 style={{ marginTop: 0, fontSize: 20 }}>دعوة موظف</h2><div className="form-grid"><div className="field"><label>البريد الإلكتروني</label><input type="email" required className="input" value={email} onChange={e => setEmail(e.target.value)} data-testid="input-invitation-email" /></div><div className="field"><label>الدور</label><select className="select" value={role} onChange={e => setRole(e.target.value)}>{Object.entries(roleNames).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></div><div className="field"><label>الفروع (اختياري)</label><select multiple className="select" value={branchIds.map(String)} onChange={e => setBranchIds(Array.from(e.target.selectedOptions, o => Number(o.value)))} style={{ minHeight: 80 }}>{(branches.data || []).filter(b => b.isActive).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div></div>{error && <p role="alert" style={{ color: '#a64434' }}>{error}</p>}<button className="btn btn-primary" disabled={create.isPending}><Plus size={17} />إرسال دعوة</button></form>
    <div className="stack"><section className="panel"><h2 style={{ fontSize: 20, marginTop: 0 }}>الموظفون</h2>{users.isLoading ? <div className="skeleton" /> : users.isError ? <ErrorBox retry={() => void users.refetch()} /> : !users.data?.length ? <Empty title="لا يوجد موظفون مضافون" detail="تظهر الحسابات النشطة والمعلقة بعد ربطها بالشركة." /> : <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>الدور</th><th>الفروع</th><th>الحالة</th></tr></thead><tbody>{users.data.map(u => <tr key={u.id}><td>{[u.firstName,u.lastName].filter(Boolean).join(' ') || u.email}<div style={{ color: '#718080', fontSize: 12 }}>{u.email}</div></td><td><select className="select" value={u.role} onChange={async e => { try { await update.mutateAsync({ userId: u.id, data: { role: e.target.value as never } }); await refresh(); } catch (err) { setError(errText(err)); } }}>{Object.entries(roleNames).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></td><td><select multiple className="select" value={u.branchIds.map(String)} onChange={async e => { const assigned = Array.from(e.target.selectedOptions, option => Number(option.value)); try { await update.mutateAsync({ userId: u.id, data: { branchIds: assigned } }); await refresh(); } catch (err) { setError(errText(err)); } }} style={{ minHeight: 74 }}>{(branches.data || []).map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></td><td><select className="select" value={u.status} onChange={async e => { try { await update.mutateAsync({ userId: u.id, data: { status: e.target.value as never } }); await refresh(); } catch (err) { setError(errText(err)); } }}><option value="active">نشط</option><option value="pending">معلّق</option><option value="suspended">موقوف</option></select></td></tr>)}</tbody></table></div>}</section>
      <section className="panel"><h2 style={{ fontSize: 20, marginTop: 0 }}>الدعوات المعلقة</h2>{invites.isLoading ? <div className="skeleton" /> : invites.isError ? <ErrorBox retry={() => void invites.refetch()} /> : !invites.data?.length ? <Empty title="لا توجد دعوات معلقة" detail="ستظهر الدعوات المرسلة ولم تُقبل بعد هنا." /> : <div className="table-wrap"><table><thead><tr><th>البريد</th><th>الدور</th><th>تاريخ الدعوة</th><th></th></tr></thead><tbody>{invites.data.map(i => <tr key={i.id}><td>{i.email}</td><td>{roleNames[i.role] || i.role}</td><td>{niceDate(i.createdAt)}</td><td><button className="btn btn-danger" onClick={() => void revokeInvite(i.id)} data-testid={`button-revoke-invitation-${i.id}`}>إلغاء الدعوة</button></td></tr>)}</tbody></table></div>}</section></div>
  </>;
}
function CustomerRecord() {
  const { customerId = '' } = useParams<{ customerId: string }>(); const id = Number(customerId); const qc = useQueryClient();
  const q = useGetCustomer(id, { query: { queryKey: getGetCustomerQueryKey(id) } }); const update = useUpdateCustomer();
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [notes, setNotes] = useState('');
  if (q.isLoading) return <Busy />; if (q.isError || !q.data) return <ErrorBox retry={() => void q.refetch()} />;
  const c = q.data;
  return <><PageTitle title={c.name} subtitle="بيانات العميل المسجلة." action={<Link href="/customers" className="btn btn-outline"><ArrowLeft size={17} />العملاء</Link>} /><form className="panel" onSubmit={async e => { e.preventDefault(); await update.mutateAsync({ customerId: id, data: { name: name || c.name, phone: phone || c.phone, notes: notes || c.notes } }); await qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) }); await qc.invalidateQueries({ queryKey: getListCustomersQueryKey() }); }}><div className="form-grid"><div className="field"><label>الاسم</label><input className="input" placeholder={c.name} value={name} onChange={e => setName(e.target.value)} /></div><div className="field"><label>الهاتف</label><input className="input" placeholder={c.phone || 'غير مسجل'} value={phone} onChange={e => setPhone(e.target.value)} /></div><div className="field" style={{ gridColumn: '1/-1' }}><label>ملاحظات</label><textarea className="textarea" placeholder={c.notes || 'لا توجد ملاحظات'} value={notes} onChange={e => setNotes(e.target.value)} /></div></div><button className="btn btn-primary" disabled={update.isPending}>حفظ التعديلات</button></form></>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function Router() {
  return <RoutedErrorBoundary><Switch>
    <Route path="/"><SignedIn><Redirect to="/dashboard" /></SignedIn><SignedOut><Home /></SignedOut></Route>
    <Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/dashboard"><Protected><Dashboard /></Protected></Route>
    <Route path="/orders"><Protected><Orders /></Protected></Route>
    <Route path="/orders/new"><Protected><NewOrder /></Protected></Route>
    <Route path="/orders/:orderId"><Protected><OrderDetail /></Protected></Route>
    <Route path="/customers"><Protected><Customers /></Protected></Route>
    <Route path="/customers/:customerId"><Protected><CustomerRecord /></Protected></Route>
    <Route path="/branches"><Protected><Branches /></Protected></Route>
    <Route path="/team"><Protected><Team /></Protected></Route>
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}
function ClerkRoutesAndProvider() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={{
    theme: shadcn, cssLayerName: 'clerk', options: { logoPlacement: 'inside', logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
    variables: { colorPrimary: '#286d64', colorForeground: '#203b45', colorMutedForeground: '#718080', colorDanger: '#a64434', colorBackground: '#fbfaf5', colorInput: '#fffdf8', colorInputForeground: '#203b45', colorNeutral: '#203b45', fontFamily: "'IBM Plex Sans Arabic', sans-serif", borderRadius: '0.8rem' },
    elements: { rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden', card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none', headerTitle: 'text-[#203b45]', headerSubtitle: 'text-[#718080]', socialButtonsBlockButtonText: 'text-[#203b45]', formFieldLabel: 'text-[#203b45]', footerActionLink: 'text-[#286d64]', footerActionText: 'text-[#718080]', dividerText: 'text-[#718080]', identityPreviewEditButton: 'text-[#286d64]', formFieldSuccessText: 'text-[#286d64]', alertText: 'text-[#a64434]', logoBox: 'rounded-xl', logoImage: 'rounded-lg', socialButtonsBlockButton: 'border-[#d8d7cc]', formButtonPrimary: 'bg-[#286d64] hover:bg-[#205b54]', formFieldInput: 'border-[#d8d7cc] text-[#203b45]', footerAction: 'text-[#718080]', dividerLine: 'bg-[#e1ddd1]', alert: 'border-[#e8c8bd]', otpCodeFieldInput: 'border-[#d8d7cc]', formFieldRow: 'text-[#203b45]', main: 'text-[#203b45]' },
  }} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'مرحباً بعودتك', subtitle: 'سجّل الدخول إلى حساب العمل' } }, signUp: { start: { title: 'إنشاء حساب الموظف', subtitle: 'استخدم الدعوة المرسلة إليك' } } }} routerPush={(to: string) => setLocation(stripBase(to))} routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}>
    <ClerkCacheReset /><Router />
  </ClerkProvider>;
}
function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ClerkRoutesAndProvider /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
