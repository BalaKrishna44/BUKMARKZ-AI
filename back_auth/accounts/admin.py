from django.contrib import admin

from .models import CustomUser, EmailOTP, Country


class EmailOTPAdmin(admin.ModelAdmin):
    list_display = ('user', 'otp', 'validated', 'expires')
    list_filter = ('validated', )
    list_display_links = ('user', )


class CustomUserAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'is_subscribed', 'country',)
    list_filter = ('is_subscribed', 'country', )


admin.site.register(CustomUser, CustomUserAdmin)
admin.site.register(EmailOTP, EmailOTPAdmin)
admin.site.register(Country)
