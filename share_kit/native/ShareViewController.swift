// ios/Share Extension/ShareViewController.swift
import receive_sharing_intent

class ShareViewController: RSIShareViewController {

    // true (the default): no sheet is shown; the extension hands the link to the app straight away.
    // false: show a small compose sheet ("Add a caption...", Send) first.
    override func shouldAutoRedirect() -> Bool {
        return true
    }
}
