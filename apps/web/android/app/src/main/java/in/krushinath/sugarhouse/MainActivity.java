package in.krushinath.sugarhouse;

import android.webkit.WebView;
import android.webkit.CookieManager;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = bridge == null ? null : bridge.getWebView();
        if (webView != null) {
            // The production API is a separate HTTPS origin and uses an HttpOnly refresh cookie.
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        WebView webView = bridge == null ? null : bridge.getWebView();
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
