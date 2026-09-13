"""
akshare 数据源模块 - 专门用于中国 A 股市场数据
"""
from datetime import datetime, timedelta
from typing import Annotated

import pandas as pd

from .symbol_utils import NoMarketDataError


def _parse_a_share_symbol(symbol: str) -> tuple[str, str]:
    """
    解析 A 股股票代码
    返回：(股票代码，市场后缀)
    例如：600519.SS -> ('600519', 'SS')
          000001.SZ -> ('000001', 'SZ')
          688561.SH -> ('688561', 'SH')
    """
    if '.' in symbol:
        code, market = symbol.rsplit('.', 1)
        # 标准化市场后缀：.SH 和 .SS 都映射到上海
        if market.upper() in ('SH', 'SS'):
            return code, 'SS'  # 上海（包括科创板 .SH）
        elif market.upper() == 'SZ':
            return code, 'SZ'  # 深圳
        else:
            return code, market
    # 默认根据代码开头判断
    if symbol.startswith('68'):
        return symbol, 'SS'  # 科创板（上海）
    elif symbol.startswith('6'):
        return symbol, 'SS'  # 上海主板
    elif symbol.startswith(('0', '2', '3')):
        return symbol, 'SZ'  # 深圳
    else:
        return symbol, 'SS'  # 默认上海


def get_akshare_stock(
    symbol: Annotated[str, "ticker symbol of the company (e.g. 600519.SS)"],
    start_date: Annotated[str, "Start date in yyyy-mm-dd format"],
    end_date: Annotated[str, "End date in yyyy-mm-dd format"],
):
    """
    使用 akshare 获取 A 股历史行情数据
    
    参数:
        symbol: 股票代码，如 600519.SS 或 000001.SZ
        start_date: 开始日期，格式 yyyy-mm-dd
        end_date: 结束日期，格式 yyyy-mm-dd
    """
    import akshare as ak
    
    # 解析股票代码
    code, market = _parse_a_share_symbol(symbol)
    
    # 转换日期格式
    start_str = start_date.replace('-', '')
    end_str = end_date.replace('-', '')
    
    try:
        # 获取历史行情数据
        df = ak.stock_zh_a_hist(
            symbol=code,
            period="daily",
            start_date=start_str,
            end_date=end_str,
            adjust="qfq"  # 前复权
        )
        
        if df.empty:
            raise NoMarketDataError(
                symbol, code, f"no data between {start_date} and {end_date}"
            )
        
        # 重命名列以匹配 yfinance 格式
        df = df.rename(columns={
            '日期': 'Date',
            '开盘': 'Open',
            '收盘': 'Close',
            '最高': 'High',
            '最低': 'Low',
            '成交量': 'Volume',
            '成交额': 'Adj Close',  # 用成交额作为调整后的收盘价替代
            '振幅': 'Amplitude',
            '涨跌幅': 'Change%',
            '涨跌额': 'Change',
            '换手率': 'Turnover'
        })
        
        # 确保 Date 列是日期格式并设为索引
        df['Date'] = pd.to_datetime(df['Date'])
        df = df.set_index('Date')
        
        # 移除时区信息
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        
        # 检查数据是否新鲜
        from .stockstats_utils import _assert_ohlcv_not_stale
        _assert_ohlcv_not_stale(df, end_date, symbol, code)
        
        # 四舍五入数值列
        numeric_cols = ['Open', 'Close', 'High', 'Low', 'Volume', 'Adj Close']
        for col in numeric_cols:
            if col in df.columns:
                df[col] = df[col].round(2)
        
        # 转换为 CSV 字符串
        csv_string = df.to_csv()
        
        # 添加头部信息
        label = f"{code} ({market})"
        header = f"# Stock data for {label} from {start_date} to {end_date}\n"
        header += f"# Total records: {len(df)}\n"
        header += f"# Data retrieved on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        header += f"# Source: akshare (A 股专用数据源)\n\n"
        
        return header + csv_string
        
    except Exception as e:
        raise NoMarketDataError(symbol, code, f"akshare error: {str(e)}")


def get_akshare_indicator(
    symbol: Annotated[str, "ticker symbol of the company"],
    indicator: Annotated[str, "technical indicator to get the analysis and report of"],
    curr_date: Annotated[str, "The current trading date you are trading on, YYYY-mm-dd"],
    look_back_days: Annotated[int, "how many days to look back"],
) -> str:
    """
    使用 akshare 获取技术指标数据
    
    注意：akshare 主要提供原始行情数据，技术指标计算使用 stockstats
    """
    import akshare as ak
    from stockstats import StockDataFrame
    
    code, market = _parse_a_share_symbol(symbol)
    
    # 计算日期范围
    end_dt = datetime.strptime(curr_date, "%Y-%m-%d")
    start_dt = end_dt - timedelta(days=look_back_days)
    start_str = start_dt.strftime("%Y%m%d")
    end_str = end_dt.strftime("%Y%m%d")
    
    try:
        # 获取历史数据
        df = ak.stock_zh_a_hist(
            symbol=code,
            period="daily",
            start_date=start_str,
            end_date=end_str,
            adjust="qfq"
        )
        
        if df.empty:
            raise NoMarketDataError(
                symbol, code, f"no data for indicators between {start_dt} and {end_dt}"
            )
        
        # 使用 stockstats 计算技术指标
        # 重命名列以匹配 stockstats 要求
        df = df.rename(columns={
            '收盘': 'close',
            '最高': 'high',
            '最低': 'low',
            '成交量': 'volume',
            '开盘': 'open'
        })
        
        stock = StockDataFrame.retype(df)
        
        # 根据指标名称获取数据
        indicator_map = {
            'close_5_sma': 'close_5_sma',
            'close_10_sma': 'close_10_sma',
            'close_20_sma': 'close_20_sma',
            'close_50_sma': 'close_50_sma',
            'close_200_sma': 'close_200_sma',
            'close_5_ema': 'close_5_ema',
            'close_10_ema': 'close_10_ema',
            'close_20_ema': 'close_20_ema',
            'macd': 'macd',
            'macd_signal': 'macd_signal',
            'macd_hist': 'macd_hist',
            'rsi_6': 'rsi_6',
            'rsi_12': 'rsi_12',
            'rsi_24': 'rsi_24',
            'boll_ub': 'boll_ub',
            'boll': 'boll',
            'boll_lb': 'boll_lb',
        }
        
        indicator_key = indicator_map.get(indicator, indicator)
        
        if indicator_key not in stock.columns:
            return f"Indicator '{indicator}' not available"
        
        # 获取最新的数据
        latest = stock[indicator_key].iloc[-1]
        
        # 生成报告
        header = f"# Technical indicator '{indicator}' for {code} as of {curr_date}\n"
        header += f"# Source: akshare + stockstats\n\n"
        header += f"Current value: {latest:.2f}\n"
        
        return header
        
    except Exception as e:
        raise NoMarketDataError(symbol, code, f"indicator calculation error: {str(e)}")


def get_akshare_fundamentals(
    symbol: Annotated[str, "ticker symbol of the company"],
    date: Annotated[str, "Reference date in yyyy-mm-dd format"],
) -> str:
    """
    使用 akshare 获取 A 股基本面数据
    """
    import akshare as ak
    
    code, market = _parse_a_share_symbol(symbol)
    
    try:
        # 获取个股信息
        info_df = ak.stock_individual_info(symbol=code)
        
        result = f"# Fundamental data for {code} ({market})\n"
        result += f"# Source: akshare\n\n"
        
        # 尝试获取更多信息
        try:
            # 获取公司资料
            profile_df = ak.stock_individual_fundament_df(symbol=code)
            result += profile_df.to_csv()
        except:
            result += "# Detailed fundamentals not available via akshare\n"
        
        return result
        
    except Exception as e:
        return f"Fundamentals data unavailable: {str(e)}"


# 导出主要函数
get_stock = get_akshare_stock
get_indicator = get_akshare_indicator
get_fundamentals = get_akshare_fundamentals


# 添加缺失的导出函数（作为占位符，返回提示）
def get_balance_sheet(symbol: str, date: str) -> str:
    """资产负债表 - 暂不支持"""
    return "Balance sheet data not available via akshare"


def get_cashflow(symbol: str, date: str) -> str:
    """现金流量表 - 暂不支持"""
    return "Cash flow data not available via akshare"


def get_income_statement(symbol: str, date: str) -> str:
    """利润表 - 暂不支持"""
    return "Income statement data not available via akshare"


def get_insider_transactions(symbol: str) -> str:
    """内幕交易数据 - 暂不支持"""
    return "Insider transactions not available via akshare"


def get_global_news(query: str, lookback_days: int) -> str:
    """全球新闻 - 暂不支持"""
    return "Global news not available via akshare"
