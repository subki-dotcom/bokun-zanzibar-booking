import { Link } from "react-router-dom";
import { BsBank, BsCashCoin, BsCheckCircleFill, BsChevronRight, BsExclamationTriangleFill, BsInfoCircleFill, BsPieChartFill, BsWallet2 } from "react-icons/bs";
import { formatCurrency } from "../../../utils/formatters";

export const balanceMoney = (value, currency) => value == null || !currency ? "Unavailable" : formatCurrency(Number(value), currency);
const percentage = (amount, total) => Number(total) ? `${(Math.abs(Number(amount || 0)) / Math.abs(Number(total)) * 100).toFixed(1)}%` : "—";

export const BalanceSheetSkeleton = () => <div className="bs-skeleton" role="status" aria-label="Loading Balance Sheet">{Array.from({ length: 7 }, (_, index) => <span key={index} />)}</div>;

export const SummaryCard = ({ label, value, detail, tone = "blue", icon: Icon = BsWallet2, status }) => <article className={`bs-summary-card is-${tone}`}><span className="bs-summary-icon"><Icon aria-hidden="true" /></span><div><small>{label}</small><strong>{value}</strong><span>{detail}</span>{status ? <em>{status}</em> : null}</div></article>;

export const BalanceStatusCard = ({ balanced, difference, currency, hasData }) => <SummaryCard label="Balance Sheet Status" value={!hasData ? "No ledger data" : balanced ? "Balanced" : "Out of Balance"} detail={!hasData ? "No balances at this date" : balanced ? "Assets = Liabilities + Equity" : `Difference: ${balanceMoney(difference, currency)}`} tone={!hasData ? "gray" : balanced ? "green" : "red"} icon={balanced ? BsCheckCircleFill : BsExclamationTriangleFill} status={!hasData ? "Not evaluated" : balanced ? "Balanced" : "Review required"} />;

export const BalanceSheetSection = ({ title, subtitle, rows = [], total, currency, icon: Icon = BsBank }) => <section className="bs-section"><header><span><Icon aria-hidden="true" /></span><div><h2>{title}</h2><p>{subtitle}</p></div><strong>{balanceMoney(total, currency)}</strong></header>{rows.length ? <><div className="bs-table-head"><span>Account</span><span>Amount</span><span>% of total</span><span /></div><div className="bs-rows">{rows.map((row) => <Link to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.accountCode)}&view=account`} className="bs-row" key={row.accountCode}><span><b>{row.accountName}</b><small>{row.accountCode}{row.parentCode ? ` · Group ${row.parentCode}` : ""}</small></span><strong>{balanceMoney(row.amount, currency)}</strong><span>{percentage(row.amount, total)}</span><BsChevronRight aria-hidden="true" /></Link>)}</div><footer><span>Total {title}</span><strong>{balanceMoney(total, currency)}</strong><b>{Number(total) ? "100%" : "—"}</b></footer></> : <div className="bs-empty">No {title.toLowerCase()} balances found for this reporting date.</div>}</section>;

export const AccountingEquationCard = ({ currency, mixedCurrencies }) => <aside className="bs-equation"><BsInfoCircleFill aria-hidden="true" /><div><h2>About the Balance Sheet</h2><p>The Balance Sheet shows the company’s financial position at a specific point in time and follows the accounting equation:</p><strong>Assets = Liabilities + Equity</strong><small>Generated from the General Ledger. {mixedCurrencies ? "The ledger contains multiple base currencies, so consolidated amounts are unavailable until an explicit conversion basis exists." : currency ? `All amounts are displayed in the company base currency (${currency}).` : "No company base currency could be established from the ledger for this date."}</small></div></aside>;

export const balanceIcons = { assets: BsBank, liabilities: BsCashCoin, equity: BsPieChartFill };
