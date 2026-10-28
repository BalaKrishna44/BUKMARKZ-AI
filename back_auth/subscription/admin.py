from django.contrib import admin

from .models import Payment, UserSubscription, Subscription, Withdraw, SubscriptionFeature


class PaymentAdmin(admin.ModelAdmin):
    list_display = ('user', 'stripe_charge_id', 'amount', 'timestamp')


class UserSubscriptionAdmin(admin.ModelAdmin):
    list_display = ('user', 'subscription', 'started', 'expires', 'trial')
    list_filter = ('subscription',)


class WithdrawAdmin(admin.ModelAdmin):
    list_display = ('user', 'withdrawal_date', 'amount')


class SubscriptionFeatureAdmin(admin.TabularInline):
    model = SubscriptionFeature
    extra = 1


class SubscriptionAdmin(admin.ModelAdmin):
    inlines = [SubscriptionFeatureAdmin]
    list_display = ('name', 'price', 'trial_period')


admin.site.register(Payment, PaymentAdmin)
admin.site.register(UserSubscription, UserSubscriptionAdmin)
admin.site.register(Subscription, SubscriptionAdmin)
admin.site.register(Withdraw, WithdrawAdmin)
